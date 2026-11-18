import type { AppState, Project, TodoFile, Workspace } from '../model/types';
import type { MutationDefinition, OperationContext, OperationDefinition, Result } from '../operations/types';
import { err, ok } from '../operations/utils';
import { parse } from '../parser/parse';
import { classifyMarker, parseFrontmatter, type MarkerStatus } from '../parser/frontmatter';
import { serialize } from '../parser/serialize';
import type { FileSystem } from './fileSystem';
import type { WorkspaceHandle } from './workspaceHandle';
import type { OperationPreview } from './changes';
import type { WorkspaceWarning } from './warnings';
import { ExternalChangeError } from './errors';

interface Plan {
  description: string;
  newTodoFile: TodoFile;
  before: string;
  after: string;
}

// File mode: one workspace file, parsed as a whole `TodoFile` (H1-delimited
// projects). Mutation re-serializes and writes the whole file — there's only
// ever one file to write, unlike directory mode.
export class FileWorkspaceHandle implements WorkspaceHandle {
  private todoFile: TodoFile | undefined;
  private lastMtimeMs: number | undefined;
  private loadWarnings: WorkspaceWarning[] = [];
  private marker: MarkerStatus = 'absent';

  constructor(
    readonly id: string,
    private readonly filePath: string,
    private readonly fs: FileSystem,
  ) {}

  private async statMtime(): Promise<number | undefined> {
    try {
      return (await this.fs.stat(this.filePath)).mtimeMs;
    } catch {
      return undefined;
    }
  }

  async reload(): Promise<void> {
    let content: string;
    try {
      content = await this.fs.read(this.filePath);
    } catch {
      content = '';
    }
    const { file, warnings } = parse(content);
    this.todoFile = file;
    this.marker = classifyMarker(parseFrontmatter(content).frontmatter.recognized.markdone);
    this.loadWarnings = warnings.map(message => ({ message }));
    if (this.marker === 'unsupported' || this.marker === 'unreadable') {
      this.loadWarnings.push({ message: 'markdone marker is unsupported or unreadable — this file will not be written' });
    }
    this.lastMtimeMs = await this.statMtime();
  }

  private requireLoaded(): TodoFile {
    if (!this.todoFile) throw new Error(`WorkspaceHandle '${this.id}' not loaded — call reload() first`);
    return this.todoFile;
  }

  listProjects(): Project[] {
    return this.requireLoaded().projects;
  }

  getProject(projectId: string): Project | undefined {
    return this.requireLoaded().projects.find(p => p.name === projectId);
  }

  warnings(): WorkspaceWarning[] {
    return this.loadWarnings;
  }

  // The workspace file's marker (spec: "The Markdone Marker"). A file mode
  // workspace loads with or without one; an unsupported one is never written.
  markerStatus(): MarkerStatus {
    return this.marker;
  }

  toWorkspace(): Workspace {
    return { config: { id: this.id, name: this.id, filePath: this.filePath }, todoFile: this.requireLoaded() };
  }

  // Pure: runs the operation against the currently loaded state and
  // serializes both sides, without touching the filesystem. Shared by
  // applyOperation and previewOperation so a preview always matches what a
  // subsequent apply writes.
  private plan(op: OperationDefinition, input: Record<string, unknown>, ctx?: OperationContext): Result<Plan> {
    const todoFile = this.requireLoaded();
    if (this.marker === 'unsupported' || this.marker === 'unreadable') {
      return err('UNSUPPORTED_VERSION', `The workspace file's markdone marker is not a supported spec version — refusing to write ${this.filePath}`);
    }

    const syntheticState: AppState = {
      workspaces: [{ config: { id: this.id, name: this.id, filePath: this.filePath }, todoFile }],
      activeScope: this.id,
    };
    // Dispatches through the operation's own `execute` (registry.ts) rather
    // than the task/project-only `operationHandlers` map, so batch ops
    // (`applyBatch`, which isn't a key in that map) can run here too. Every
    // op reachable here is mutating, so `execute` always yields `AppState`.
    const execute = op.execute as (state: AppState, input: Record<string, unknown>, ctx?: OperationContext) => Result<AppState>;
    const result = execute(syntheticState, input, ctx);
    if (!result.ok) return result;

    const newTodoFile = result.value.workspaces[0].todoFile;
    return ok({
      description: (op as MutationDefinition).describe(input),
      newTodoFile,
      before: serialize(todoFile),
      after: serialize(newTodoFile),
    });
  }

  async previewOperation(op: OperationDefinition, input: Record<string, unknown>, ctx?: OperationContext): Promise<Result<OperationPreview>> {
    const planResult = this.plan(op, input, ctx);
    if (!planResult.ok) return planResult;
    const { description, before, after } = planResult.value;
    const changes = before === after ? [] : [{ path: this.filePath, before, after }];
    return ok({ description, changes });
  }

  async applyOperation(op: OperationDefinition, input: Record<string, unknown>, ctx?: OperationContext): Promise<Result<OperationPreview>> {
    const planResult = this.plan(op, input, ctx);
    if (!planResult.ok) return planResult;
    await this.persist(planResult.value.newTodoFile);
    const { description, before, after } = planResult.value;
    const changes = before === after ? [] : [{ path: this.filePath, before, after }];
    return ok({ description, changes });
  }

  private async persist(newTodoFile: TodoFile): Promise<void> {
    const currentMtime = await this.statMtime();
    // undefined means "no file existed at load" — not "no conflict is
    // possible". The file may have been created externally since, so that
    // case asserts absence (current must still be undefined) rather than
    // skipping the check.
    const changed = this.lastMtimeMs === undefined ? currentMtime !== undefined : currentMtime !== this.lastMtimeMs;
    if (changed) throw new ExternalChangeError(this.id);
    await this.fs.write(this.filePath, serialize(newTodoFile));
    this.todoFile = newTodoFile;
    this.lastMtimeMs = await this.statMtime();
  }
}
