import type { ChecklistProject, Frontmatter, KanbanProject, Project, TodoFile } from '../model/types';
import { parseFrontmatter } from './frontmatter';
import { parseChecklistBody, splitKanbanBody, _resetIdCounter, type ColumnInferenceMode } from './body';

export { _resetIdCounter };

const EMPTY_FRONTMATTER: Frontmatter = { raw: '', recognized: {}, unknown: {}, present: false };

// File-mode projects have no frontmatter of their own, so layout is
// inferred exactly as in v1: any H2 anywhere in the body makes it kanban.
function parseFileModeProject(name: string, lines: string[], warnings: string[]): Project {
  const hasH2 = lines.some(l => l.startsWith('## '));
  if (hasH2) {
    const { preamble, sections } = splitKanbanBody(lines, 'any-h2', undefined, warnings);
    const project: KanbanProject = { layout: 'kanban', name, frontmatter: EMPTY_FRONTMATTER, preamble, sections };
    return project;
  }
  const project: ChecklistProject = {
    layout: 'checklist',
    name,
    frontmatter: EMPTY_FRONTMATTER,
    blocks: parseChecklistBody(lines, warnings),
  };
  return project;
}

function ensureInbox(projects: Project[], warnings: string[]): Project[] {
  const inboxIndex = projects.findIndex(p => p.name.toLowerCase() === 'inbox');

  if (inboxIndex === -1) {
    const empty: ChecklistProject = {
      layout: 'checklist',
      name: 'Inbox',
      frontmatter: EMPTY_FRONTMATTER,
      blocks: [],
    };
    return [empty, ...projects];
  }

  const inbox = projects[inboxIndex];
  if (inbox.layout === 'kanban') {
    warnings.push('The Inbox project is kanban-layout, which is not permitted — content preserved, but reported as an error');
  }
  if (inboxIndex === 0) return projects;
  const rest = projects.filter((_, i) => i !== inboxIndex);
  return [inbox, ...rest];
}

export interface ParseResult {
  file: TodoFile;
  warnings: string[];
}

// File mode: one workspace file, `# Project` H1s, workspace-level
// frontmatter, a protected `# Inbox` promoted to first position.
export function parse(markdown: string): ParseResult {
  const warnings: string[] = [];
  const { frontmatter, consumedLines, warning } = parseFrontmatter(markdown);
  if (warning) warnings.push(warning);

  const allLines = markdown.split('\n');
  const afterFrontmatter = allLines.slice(consumedLines);

  const firstH1 = afterFrontmatter.findIndex(l => l.startsWith('# '));
  const preambleLines = firstH1 === -1 ? afterFrontmatter : afterFrontmatter.slice(0, firstH1);
  const preamble = parseChecklistBody(preambleLines, warnings);

  const projects: Project[] = [];
  let currentName: string | null = null;
  let currentLines: string[] = [];

  const bodyLines = firstH1 === -1 ? [] : afterFrontmatter.slice(firstH1);
  for (const line of bodyLines) {
    if (line.startsWith('# ')) {
      if (currentName !== null) projects.push(parseFileModeProject(currentName, currentLines, warnings));
      currentName = line.slice(2).trim();
      currentLines = [];
    } else if (currentName !== null) {
      currentLines.push(line);
    }
  }
  if (currentName !== null) projects.push(parseFileModeProject(currentName, currentLines, warnings));

  return {
    file: { frontmatter, preamble, projects: ensureInbox(projects, warnings) },
    warnings,
  };
}

export interface ParseProjectOptions {
  // The last-resort name source (spec: title > first H1 > fallback): the
  // filename without extension for a root file, the parent folder's name for
  // a nested one — a nested file never falls back to its own filename.
  filenameFallback: string;
  // Workspace-level defaults from `_markdone.md` (spec: "owner, layout,
  // columns, priority ... defaults inherited by every project"). Applied
  // only to the in-memory `recognized` view for any key the project's own
  // frontmatter doesn't set — `raw` is untouched, so a default is never
  // written into a file it wasn't already in.
  defaults?: {
    layout?: 'checklist' | 'kanban';
    columns?: string[];
    owner?: string;
    priority?: number;
    onComplete?: string;
  };
}

function applyDefaults(fm: Frontmatter, defaults: ParseProjectOptions['defaults']): Frontmatter {
  if (!defaults) return fm;
  const recognized = { ...fm.recognized };
  if (recognized.layout === undefined && defaults.layout !== undefined) recognized.layout = defaults.layout;
  if (recognized.columns === undefined && defaults.columns !== undefined) recognized.columns = defaults.columns;
  if (recognized.owner === undefined && defaults.owner !== undefined) recognized.owner = defaults.owner;
  if (recognized.priority === undefined && defaults.priority !== undefined) recognized.priority = defaults.priority;
  if (recognized['on-complete'] === undefined && defaults.onComplete !== undefined) {
    recognized['on-complete'] = defaults.onComplete;
  }
  return { ...fm, recognized };
}

export interface ParseProjectResult {
  project: Project;
  warnings: string[];
}

// Directory mode: one file is exactly one project. Frontmatter is
// project-level; `layout`/`columns` (rather than H2 inference) decide
// structure.
export function parseProject(markdown: string, options: ParseProjectOptions): ParseProjectResult {
  const warnings: string[] = [];
  const { frontmatter: parsedFrontmatter, consumedLines, warning } = parseFrontmatter(markdown);
  if (warning) warnings.push(warning);
  const frontmatter = applyDefaults(parsedFrontmatter, options.defaults);

  const allLines = markdown.split('\n');
  let bodyLines = allLines.slice(consumedLines);

  const titleFromFrontmatter = frontmatter.recognized.title;
  let name: string | undefined = typeof titleFromFrontmatter === 'string' ? titleFromFrontmatter : undefined;
  if (name === undefined) {
    const firstH1Index = bodyLines.findIndex(l => l.startsWith('# '));
    if (firstH1Index !== -1) {
      // Read for the name, but do NOT remove it from the body: it's still
      // a real line of the source file, and dropping it would violate
      // round-trip fidelity (requirement 1) for a file with no frontmatter
      // title — directory mode has no other structural use for an H1 (it
      // isn't the project delimiter the way it is in file mode), so it's
      // content the parser doesn't need to consume, just read.
      name = bodyLines[firstH1Index].slice(2).trim();
    }
  }
  if (name === undefined) name = options.filenameFallback;

  const layout: 'checklist' | 'kanban' = frontmatter.recognized.layout === 'kanban' ? 'kanban' : 'checklist';

  if (layout === 'kanban') {
    const columnsRaw = frontmatter.recognized.columns;
    const declaredColumns = Array.isArray(columnsRaw) ? columnsRaw.map(String) : undefined;
    const mode: ColumnInferenceMode = declaredColumns ? 'declared' : 'task-bearing-only';
    const { preamble, sections } = splitKanbanBody(bodyLines, mode, declaredColumns, warnings);
    const project: KanbanProject = {
      layout: 'kanban',
      name,
      frontmatter,
      preamble,
      sections,
    };
    if (declaredColumns) project.columnOrder = declaredColumns;
    return { project, warnings };
  }

  // Checked against the file's own frontmatter, not the defaults-merged
  // view: a `columns` value inherited from `_markdone.md` shouldn't warn
  // just because this particular project resolved to checklist layout —
  // the warning is about what the file itself declared.
  if (parsedFrontmatter.recognized.columns !== undefined) {
    warnings.push('`columns:` is ignored under layout: checklist');
  }
  const project: ChecklistProject = {
    layout: 'checklist',
    name,
    frontmatter,
    blocks: parseChecklistBody(bodyLines, warnings),
  };
  return { project, warnings };
}
