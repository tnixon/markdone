import type { AppState, Frontmatter, Project, Workspace } from '../model/types';
import type { MutationDefinition, OperationContext, OperationDefinition, Result } from '../operations/types';
import { ok } from '../operations/utils';
import { parseProject } from '../parser/parse';
import { CURRENT_MARKER_VERSION, parseFrontmatter, updateFrontmatterKey } from '../parser/frontmatter';
import { serializeProject, frontmatterLines } from '../parser/serialize';
import { discoverProjects, type DiscoveredFile, type DiscoveryReport } from './discovery';
import type { FileSystem } from './fileSystem';
import type { WorkspaceHandle } from './workspaceHandle';
import type { FileChange, OperationPreview } from './changes';
import type { WorkspaceWarning } from './warnings';
import { ExternalChangeError } from './errors';

const EMPTY_FRONTMATTER: Frontmatter = { raw: '', recognized: {}, unknown: {}, present: false };
const DEFAULT_DEFAULTS_FILE_NAME = '_markdone.md';

function joinPath(dir: string, name: string): string {
  return dir === '' ? name : `${dir.replace(/\/+$/, '')}/${name}`;
}

function stemOf(fileName: string): string {
  return fileName.replace(/\.md$/i, '');
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'project';
}

// The file a new inbox is created as: just the marker (spec: "The Inbox").
const NEW_INBOX_CONTENT = `---\nmarkdone: ${CURRENT_MARKER_VERSION}\n---\n`;
const PROJECT_FOLDER_FILE_NAME = 'todo.md';

interface WorkspaceDefaults {
  layout?: 'checklist' | 'kanban';
  columns?: string[];
  owner?: string;
  priority?: number;
  onComplete?: string;
}

interface ProjectEntry {
  // Workspace-relative path without extension (`reading-list`,
  // `home-network/todo`) — the stable identifier used for ordering (spec)
  // and for `getProject`. Distinct from `project.name`, which is the display
  // name and may come from frontmatter `title`, the first H1, or the folder.
  id: string;
  // Workspace-relative path, `.md` included (despite the historical name).
  fileName: string;
  project: Project;
  mtimeMs: number | undefined;
}

// What one operation, once resolved against the currently loaded projects,
// turns into: which file(s) get written/deleted and how. Computed once by
// `plan()` and consumed by both `previewOperation` (just wants the
// `FileChange`s) and `applyOperation` (executes the action for real).
type PlannedAction =
  | { kind: 'update'; index: number; toWrite: Project }
  | { kind: 'add'; newProject: Project; fileName: string }
  | { kind: 'delete'; entry: ProjectEntry }
  | { kind: 'reorder'; newOrderIds: string[] };

interface PlannedChange {
  action: PlannedAction;
  fileChanges: FileChange[];
}

interface Plan {
  description: string;
  changes: PlannedChange[];
}

// Directory mode: one directory tree; a project is any `.md` file under it,
// at any depth, whose frontmatter carries a supported `markdone` marker
// (discovery.ts). `inbox.md` is enforced on load (created with the marker if
// missing); the defaults note supplies workspace-level defaults and the
// `projects:` ordering list. Mutation writes only the files an operation
// actually touched — an operation's effect is diffed against the
// previously-loaded projects to decide what to write.
export class DirectoryWorkspaceHandle implements WorkspaceHandle {
  private entries: ProjectEntry[] | undefined;
  private defaultsFrontmatter: Frontmatter | undefined;
  private defaultsBody = '';
  private defaultsFileName: string | undefined;
  private defaultsMtimeMs: number | undefined;
  private loadWarnings: WorkspaceWarning[] = [];
  private report: DiscoveryReport | undefined;

  constructor(
    readonly id: string,
    private readonly dirPath: string,
    private readonly fs: FileSystem,
    private readonly options: { defaultsFileName?: string } = {},
  ) {}

  private get configuredDefaultsFileName(): string {
    return this.options.defaultsFileName ?? DEFAULT_DEFAULTS_FILE_NAME;
  }

  private async statMtimeAt(path: string): Promise<number | undefined> {
    try {
      return (await this.fs.stat(path)).mtimeMs;
    } catch {
      return undefined;
    }
  }

  private currentDefaults(): WorkspaceDefaults {
    const recognized = this.defaultsFrontmatter?.recognized ?? {};
    return {
      layout: recognized.layout === 'kanban' ? 'kanban' : recognized.layout === 'checklist' ? 'checklist' : undefined,
      columns: Array.isArray(recognized.columns) ? recognized.columns.map(String) : undefined,
      owner: typeof recognized.owner === 'string' ? recognized.owner : undefined,
      priority: typeof recognized.priority === 'number' ? recognized.priority : undefined,
      onComplete: typeof recognized['on-complete'] === 'string' ? (recognized['on-complete'] as string) : undefined,
    };
  }

  async reload(): Promise<void> {
    const report = await discoverProjects(this.fs, this.dirPath, { defaultsFileName: this.configuredDefaultsFileName });
    const warnings: WorkspaceWarning[] = [];

    const defaultsFile = report.defaults;
    if (defaultsFile) {
      if (defaultsFile.frontmatterWarning) warnings.push({ path: defaultsFile.path, message: defaultsFile.frontmatterWarning });
      const { consumedLines } = parseFrontmatter(defaultsFile.content);
      this.defaultsFrontmatter = defaultsFile.frontmatter;
      this.defaultsBody = defaultsFile.content.split('\n').slice(consumedLines).join('\n');
      this.defaultsFileName = defaultsFile.path;
      this.defaultsMtimeMs = defaultsFile.mtimeMs;
    } else {
      this.defaultsFrontmatter = undefined;
      this.defaultsBody = '';
      this.defaultsFileName = undefined;
      this.defaultsMtimeMs = undefined;
    }

    const defaults = this.currentDefaults();

    let inbox: DiscoveredFile | undefined = report.inbox;
    if (!inbox) {
      const inboxPath = joinPath(this.dirPath, 'inbox.md');
      await this.fs.write(inboxPath, NEW_INBOX_CONTENT);
      inbox = {
        path: 'inbox.md',
        id: 'inbox',
        content: NEW_INBOX_CONTENT,
        frontmatter: parseFrontmatter(NEW_INBOX_CONTENT).frontmatter,
        isInbox: true,
        mtimeMs: await this.statMtimeAt(inboxPath),
      };
      report.inbox = inbox;
      report.inboxMarker = 'supported';
    }

    for (const skipped of report.skipped) {
      const detail = skipped.status === 'unsupported' ? `names unsupported spec version ${String(skipped.marker)}` : `has an unreadable value (${JSON.stringify(skipped.marker)})`;
      warnings.push({
        path: skipped.path,
        message: `markdone marker ${detail} — file skipped, not loaded as a project`,
        code: 'marker',
      });
    }

    const toEntry = (file: DiscoveredFile): ProjectEntry => {
      if (file.frontmatterWarning) warnings.push({ path: file.path, message: file.frontmatterWarning });
      const { project, warnings: projectWarnings } = parseProject(file.content, {
        // A nested file never falls back to its own filename (spec).
        filenameFallback: file.isInbox ? 'Inbox' : (file.parentFolder ?? file.id),
        defaults,
      });
      // The frontmatter warning above comes from discovery's parse of the
      // same text; parseProject would repeat it, so drop the duplicate.
      const fresh = projectWarnings.filter(m => m !== file.frontmatterWarning);
      warnings.push(...fresh.map(message => ({ path: file.path, message })));
      return { id: file.id, fileName: file.path, project: { ...project, sourcePath: file.path }, mtimeMs: file.mtimeMs };
    };

    const inboxEntry = toEntry(inbox);
    const others = new Map<string, ProjectEntry>();
    for (const file of report.projects) others.set(file.id, toEntry(file));

    const orderList = Array.isArray(this.defaultsFrontmatter?.recognized.projects)
      ? (this.defaultsFrontmatter!.recognized.projects as unknown[]).map(String)
      : [];
    for (const id of orderList) {
      if (!others.has(id) && id !== inboxEntry.id) {
        warnings.push({
          path: this.defaultsFileName,
          message: `projects: entry '${id}' matches no marked file — ignored`,
          code: 'missing-project',
        });
      }
    }
    const listed = orderList.filter((id, i) => others.has(id) && orderList.indexOf(id) === i);
    const unlisted = [...others.keys()].filter(id => !orderList.includes(id)).sort((a, b) => a.localeCompare(b));

    const entries = [inboxEntry, ...listed.map(id => others.get(id)!), ...unlisted.map(id => others.get(id)!)];

    const byName = new Map<string, ProjectEntry[]>();
    for (const entry of entries) {
      const key = entry.project.name.toLowerCase();
      byName.set(key, [...(byName.get(key) ?? []), entry]);
    }
    for (const group of byName.values()) {
      if (group.length > 1) {
        const paths = group.map(e => e.fileName).join(', ');
        warnings.push({
          message: `Duplicate project name "${group[0].project.name}" (${paths}) — address by project path`,
          code: 'duplicate-name',
        });
      }
    }

    this.entries = entries;
    this.report = report;
    this.loadWarnings = warnings;
  }

  discoveryReport(): DiscoveryReport {
    if (!this.report) throw new Error(`WorkspaceHandle '${this.id}' not loaded — call reload() first`);
    return this.report;
  }

  private requireLoaded(): ProjectEntry[] {
    if (!this.entries) throw new Error(`WorkspaceHandle '${this.id}' not loaded — call reload() first`);
    return this.entries;
  }

  listProjects(): Project[] {
    return this.requireLoaded().map(e => e.project);
  }

  getProject(projectId: string): Project | undefined {
    return this.requireLoaded().find(e => e.id === projectId)?.project;
  }

  warnings(): WorkspaceWarning[] {
    return this.loadWarnings;
  }

  toWorkspace(): Workspace {
    const entries = this.requireLoaded();
    return {
      config: { id: this.id, name: this.id, filePath: this.dirPath },
      todoFile: { frontmatter: EMPTY_FRONTMATTER, preamble: [], projects: entries.map(e => e.project) },
    };
  }

  private defaultsPath(): string {
    return joinPath(this.dirPath, this.defaultsFileName ?? this.configuredDefaultsFileName);
  }

  private defaultsText(fm: Frontmatter): string {
    return [...frontmatterLines(fm), ...this.defaultsBody.split('\n')].join('\n');
  }

  private currentDefaultsText(): string {
    return this.defaultsText(this.defaultsFrontmatter ?? EMPTY_FRONTMATTER);
  }

  private planUpdate(index: number, entry: ProjectEntry, oldProject: Project, newProject: Project): PlannedChange {
    // A name change (updateProject) has to land in frontmatter `title` for
    // directory mode, since there's no `# Project` heading to carry it —
    // mirrors what serializeProject already does for kanban `columnOrder`.
    const toWrite =
      newProject.name !== oldProject.name
        ? { ...newProject, frontmatter: updateFrontmatterKey(newProject.frontmatter, 'title', newProject.name) }
        : newProject;
    const path = joinPath(this.dirPath, entry.fileName);
    return {
      action: { kind: 'update', index, toWrite },
      fileChanges: [{ path, before: serializeProject(entry.project), after: serializeProject(toWrite) }],
    };
  }

  private planAdd(newProject: Project, entries: ProjectEntry[], folderForm: boolean): PlannedChange {
    const base = slugify(newProject.name);
    const taken = (slug: string) => entries.some(e => e.id === slug || e.id.startsWith(`${slug}/`));
    let slug = base;
    for (let suffix = 2; taken(slug); suffix++) slug = `${base}-${suffix}`;
    const fileName = folderForm ? `${slug}/${PROJECT_FOLDER_FILE_NAME}` : `${slug}.md`;

    // The new file's frontmatter: the marker always; `title` when the name
    // the file would otherwise resolve to (the slug, or the folder name)
    // isn't the name the caller gave; `layout`/`columns` for a board, since a
    // directory-mode file declares its layout rather than inferring it.
    let frontmatter = updateFrontmatterKey(newProject.frontmatter, 'markdone', CURRENT_MARKER_VERSION);
    if (newProject.name !== slug) frontmatter = updateFrontmatterKey(frontmatter, 'title', newProject.name);
    if (newProject.layout === 'kanban') {
      const columns = newProject.sections.filter(s => s.kind === 'column').map(s => (s as { name: string }).name);
      frontmatter = updateFrontmatterKey(updateFrontmatterKey(frontmatter, 'layout', 'kanban'), 'columns', columns);
    }
    const toWrite: Project = { ...newProject, frontmatter, sourcePath: fileName };
    if (toWrite.layout === 'kanban' && toWrite.columnOrder === undefined) {
      toWrite.columnOrder = toWrite.sections.filter(s => s.kind === 'column').map(s => (s as { name: string }).name);
    }
    const path = joinPath(this.dirPath, fileName);
    return {
      action: { kind: 'add', newProject: toWrite, fileName },
      fileChanges: [{ path, before: null, after: serializeProject(toWrite) }],
    };
  }

  private planDelete(entry: ProjectEntry): PlannedChange {
    const fileChanges: FileChange[] = [
      { path: joinPath(this.dirPath, entry.fileName), before: serializeProject(entry.project), after: null },
    ];
    const current = this.defaultsFrontmatter?.recognized.projects;
    if (Array.isArray(current) && current.map(String).includes(entry.id)) {
      const ids = current.map(String).filter(x => x !== entry.id);
      const fm = updateFrontmatterKey(this.defaultsFrontmatter!, 'projects', ids);
      fileChanges.push({ path: this.defaultsPath(), before: this.currentDefaultsText(), after: this.defaultsText(fm) });
    }
    return { action: { kind: 'delete', entry }, fileChanges };
  }

  private planReorder(newOrderIds: string[]): PlannedChange {
    const fm = updateFrontmatterKey(this.defaultsFrontmatter ?? EMPTY_FRONTMATTER, 'projects', newOrderIds);
    return {
      action: { kind: 'reorder', newOrderIds },
      fileChanges: [
        {
          path: this.defaultsPath(),
          before: this.defaultsFileName ? this.currentDefaultsText() : null,
          after: this.defaultsText(fm),
        },
      ],
    };
  }

  // Pure: runs the operation against the currently loaded projects and
  // decides what would need to be written, without touching the filesystem.
  // Shared by applyOperation and previewOperation so a preview always
  // matches what a subsequent apply writes.
  private plan(op: OperationDefinition, input: Record<string, unknown>, ctx?: OperationContext): Result<Plan> {
    const entries = this.requireLoaded();
    const oldProjects = entries.map(e => e.project);
    const syntheticState: AppState = {
      workspaces: [
        {
          config: { id: this.id, name: this.id, filePath: this.dirPath },
          todoFile: { frontmatter: EMPTY_FRONTMATTER, preamble: [], projects: oldProjects },
        },
      ],
      activeScope: this.id,
    };
    // Dispatches through the operation's own `execute` (registry.ts) rather
    // than the task/project-only `operationHandlers` map, so batch ops
    // (`applyBatch`, which isn't a key in that map) can run here too. Every
    // op reachable here is mutating, so `execute` always yields `AppState`.
    const execute = op.execute as (state: AppState, input: Record<string, unknown>, ctx?: OperationContext) => Result<AppState>;
    const result = execute(syntheticState, input, ctx);
    if (!result.ok) return result;

    const newProjects = result.value.workspaces[0].todoFile.projects;
    const description = (op as MutationDefinition).describe(input);

    if (op.name === 'reorderProject') {
      const idByProject = new Map(entries.map(e => [e.project, e.id]));
      const newOrderIds = newProjects.slice(1).map(p => idByProject.get(p)!);
      return ok({ description, changes: [this.planReorder(newOrderIds)] });
    }

    if (newProjects.length > oldProjects.length) {
      const folderForm = op.name === 'addProject' && input.folder === true;
      return ok({ description, changes: [this.planAdd(newProjects[newProjects.length - 1], entries, folderForm)] });
    }

    if (newProjects.length < oldProjects.length) {
      const removed = oldProjects.find(p => !newProjects.includes(p));
      if (!removed) return ok({ description, changes: [] });
      const entry = entries.find(e => e.project === removed)!;
      return ok({ description, changes: [this.planDelete(entry)] });
    }

    const changes: PlannedChange[] = [];
    for (let i = 0; i < oldProjects.length; i++) {
      if (oldProjects[i] !== newProjects[i]) {
        changes.push(this.planUpdate(i, entries[i], oldProjects[i], newProjects[i]));
      }
    }
    return ok({ description, changes });
  }

  async previewOperation(op: OperationDefinition, input: Record<string, unknown>, ctx?: OperationContext): Promise<Result<OperationPreview>> {
    const planResult = this.plan(op, input, ctx);
    if (!planResult.ok) return planResult;
    return ok({
      description: planResult.value.description,
      changes: planResult.value.changes.flatMap(c => c.fileChanges),
    });
  }

  async applyOperation(op: OperationDefinition, input: Record<string, unknown>, ctx?: OperationContext): Promise<Result<OperationPreview>> {
    const planResult = this.plan(op, input, ctx);
    if (!planResult.ok) return planResult;

    for (const { action } of planResult.value.changes) {
      switch (action.kind) {
        case 'update':
          await this.persistUpdate(action.index, action.toWrite);
          break;
        case 'add':
          await this.persistAdd(action.newProject, action.fileName);
          break;
        case 'delete':
          await this.persistDelete(action.entry);
          break;
        case 'reorder':
          await this.persistReorder(action.newOrderIds);
          break;
      }
    }
    return ok({
      description: planResult.value.description,
      changes: planResult.value.changes.flatMap(c => c.fileChanges),
    });
  }

  // Shared by every persist* path that writes to (or deletes, or newly
  // creates) a file this handle is about to touch. `expected` is the mtime
  // this handle last saw for that path — `undefined` for a path this handle
  // never loaded (a brand-new project file, or _markdone.md when none
  // existed at reload()). That is NOT the same as "no conflict is
  // possible": the path may have been created externally since. So
  // `undefined` asserts absence — the path must still not exist — rather
  // than skipping the check outright.
  private async checkMtime(path: string, expected: number | undefined): Promise<void> {
    const current = await this.statMtimeAt(path);
    if (expected === undefined ? current !== undefined : current !== expected) {
      throw new ExternalChangeError(this.id);
    }
  }

  private async persistUpdate(index: number, toWrite: Project): Promise<void> {
    const entries = this.requireLoaded();
    const entry = entries[index];
    const path = joinPath(this.dirPath, entry.fileName);
    await this.checkMtime(path, entry.mtimeMs);
    await this.fs.write(path, serializeProject(toWrite));
    entries[index] = { ...entry, project: toWrite, mtimeMs: await this.statMtimeAt(path) };
  }

  private async persistAdd(newProject: Project, fileName: string): Promise<void> {
    const entries = this.requireLoaded();
    const path = joinPath(this.dirPath, fileName);
    // planAdd's slug/dedup only knows about entries loaded at reload() time;
    // a file created externally afterward at this exact path must not be
    // silently overwritten just because it wasn't loaded.
    await this.checkMtime(path, undefined);
    await this.fs.write(path, serializeProject(newProject));
    entries.push({ id: stemOf(fileName), fileName, project: newProject, mtimeMs: await this.statMtimeAt(path) });
  }

  private async persistDelete(entry: ProjectEntry): Promise<void> {
    const entries = this.requireLoaded();
    const index = entries.findIndex(e => e === entry);
    if (index === -1) return;
    const path = joinPath(this.dirPath, entry.fileName);
    await this.checkMtime(path, entry.mtimeMs);
    // Check the order list too, and before either write: deleting must not
    // clobber a concurrent edit to _markdone.md after already having removed
    // the project file out from under it.
    const orderListed = this.defaultsFrontmatter?.recognized.projects;
    if (Array.isArray(orderListed) && orderListed.map(String).includes(entry.id)) {
      await this.checkMtime(this.defaultsPath(), this.defaultsMtimeMs);
    }
    entries.splice(index, 1);
    await this.fs.delete(path);
    await this.removeFromOrderList(entry.id);
  }

  private async persistReorder(newOrderIds: string[]): Promise<void> {
    const entries = this.requireLoaded();
    await this.writeOrderList(newOrderIds);
    const entryById = new Map(entries.map(e => [e.id, e]));
    this.entries = [entries[0], ...newOrderIds.map(id => entryById.get(id)!)];
  }

  private async writeOrderList(ids: string[]): Promise<void> {
    const fm = updateFrontmatterKey(this.defaultsFrontmatter ?? EMPTY_FRONTMATTER, 'projects', ids);
    await this.persistDefaultsFile(fm);
  }

  private async removeFromOrderList(id: string): Promise<void> {
    const current = this.defaultsFrontmatter?.recognized.projects;
    if (!Array.isArray(current) || !current.includes(id)) return;
    const fm = updateFrontmatterKey(this.defaultsFrontmatter!, 'projects', current.filter(x => x !== id));
    await this.persistDefaultsFile(fm);
  }

  private async persistDefaultsFile(fm: Frontmatter): Promise<void> {
    const fileName = this.defaultsFileName ?? this.configuredDefaultsFileName;
    const path = joinPath(this.dirPath, fileName);
    await this.checkMtime(path, this.defaultsMtimeMs);
    await this.fs.write(path, this.defaultsText(fm));
    this.defaultsFrontmatter = fm;
    this.defaultsFileName = fileName;
    this.defaultsMtimeMs = await this.statMtimeAt(path);
  }
}
