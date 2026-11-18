import type { AppState, Task } from '../model/types';
import { getTasks, getColumns, getColumnTasks, getDependency } from '../model/accessors';
import { addMarkerToContent, parseFrontmatter } from '../parser/frontmatter';
import { resolveCompletionColumn } from '../operations/workflow';
import type { FileChange } from '../storage/changes';
import type { FileSystem } from '../storage/fileSystem';
import type { ResolvedWorkspace } from '../storage/resolveWorkspaces';

export type Severity = 'error' | 'warn' | 'info';

export interface LintFinding {
  severity: Severity;
  workspaceId?: string;
  path?: string;
  message: string;
  // A previewable text edit that resolves the finding (never applied by lint
  // itself — a consumer shows the diff and confirms).
  fix?: FileChange;
  // An operation that would resolve the finding, to be previewed through the
  // normal mutation path.
  proposal?: { operation: string; input: Record<string, unknown> };
}

function classifyParserWarning(message: string): Severity {
  if (message.includes('kanban-layout')) return 'error';
  const lower = message.toLowerCase();
  if (lower.includes('malformed yaml') || lower.includes('did not parse to a mapping')) return 'error';
  if (message.startsWith('Deprecated')) return 'info';
  if (message.includes('is ignored under layout')) return 'info';
  return 'warn';
}

function* walkDeep(task: Task): Iterable<Task> {
  yield task;
  for (const subtask of task.subtasks) yield* walkDeep(subtask);
}

interface WorkspaceTasks {
  workspaceId: string;
  tasks: Task[];
}

function collectWorkspaceTasks(state: AppState): WorkspaceTasks[] {
  return state.workspaces.map(workspace => {
    const tasks: Task[] = [];
    for (const project of workspace.todoFile.projects) {
      const topLevel = project.layout === 'checklist' ? getTasks(project) : getColumns(project).flatMap(getColumnTasks);
      for (const t of topLevel) tasks.push(...walkDeep(t));
    }
    return { workspaceId: workspace.config.id, tasks };
  });
}

const DEFAULTS_FILE_NAME = '_markdone.md';
const DEFAULTS_KEY_VALIDATORS: Record<string, (value: unknown) => boolean> = {
  layout: v => v === 'checklist' || v === 'kanban',
  columns: v => Array.isArray(v) && v.every(x => typeof x === 'string'),
  owner: v => typeof v === 'string',
  priority: v => typeof v === 'number',
  'on-complete': v => typeof v === 'string',
  projects: v => Array.isArray(v) && v.every(x => typeof x === 'string'),
};

async function lintDefaultsFile(ws: ResolvedWorkspace, fs: FileSystem): Promise<LintFinding[]> {
  if (!ws.isDirectory) return [];
  const path = ws.path.endsWith('/') ? `${ws.path}${DEFAULTS_FILE_NAME}` : `${ws.path}/${DEFAULTS_FILE_NAME}`;
  let content: string;
  try {
    content = await fs.read(path);
  } catch {
    return []; // _markdone.md is optional
  }
  const { frontmatter } = parseFrontmatter(content);
  const findings: LintFinding[] = [];
  for (const [key, value] of Object.entries(frontmatter.recognized)) {
    const validator = DEFAULTS_KEY_VALIDATORS[key];
    if (validator && !validator(value)) {
      findings.push({ severity: 'error', workspaceId: ws.id, path, message: `Invalid value for '${key}:' in ${DEFAULTS_FILE_NAME}` });
    }
  }
  // Spec: unknown keys are preserved, not rejected — so this is informational
  // (a likely typo or a key from a future version), not an error.
  for (const key of Object.keys(frontmatter.unknown)) {
    findings.push({ severity: 'info', workspaceId: ws.id, path, message: `Unrecognized key '${key}:' in ${DEFAULTS_FILE_NAME}` });
  }
  return findings;
}

function joinPath(dir: string, name: string): string {
  return dir === '' ? name : `${dir.replace(/\/+$/, '')}/${name}`;
}

// A previewable add-marker edit, or undefined when the file can't be marked
// safely (see `addMarkerToContent`) — the finding is then report-only.
function addMarkerFix(path: string, content: string): FileChange | undefined {
  const after = addMarkerToContent(content);
  return after === content ? undefined : { path, before: content, after };
}

// Marker/discovery findings for one directory-mode workspace (spec:
// "Directory Mode"), read from the handle's structured report rather than
// re-walking the folder.
function lintDiscovery(ws: ResolvedWorkspace, state: AppState): LintFinding[] {
  const report = ws.handle.discoveryReport?.();
  if (!report) return [];
  const findings: LintFinding[] = [];
  const at = (rel: string) => joinPath(ws.path, rel);

  for (const skipped of report.skipped) {
    const what =
      skipped.status === 'unsupported'
        ? `names unsupported spec version ${String(skipped.marker)}`
        : `has an unreadable value (${JSON.stringify(skipped.marker)})`;
    findings.push({
      severity: 'error',
      workspaceId: ws.id,
      path: skipped.path,
      message: `markdone marker ${what}; the file is skipped, not loaded as a project (report only)`,
    });
  }

  if (report.inbox && report.inboxMarker === 'absent') {
    findings.push({
      severity: 'warn',
      workspaceId: ws.id,
      path: report.inbox.path,
      message: "inbox.md has no 'markdone: 2' marker; it still loads as the inbox",
      fix: addMarkerFix(at(report.inbox.path), report.inbox.content),
    });
  }

  for (const note of report.unmarkedNotes) {
    if (!note.looksLikeTaskFile) continue;
    findings.push({
      severity: 'info',
      workspaceId: ws.id,
      path: note.path,
      message: "Unmarked note looks like a task file (layout/columns frontmatter or Markdone tokens); without 'markdone: 2' it is not a project",
      ...(note.content !== undefined && { fix: addMarkerFix(at(note.path), note.content) }),
    });
  }

  if (report.projects.length === 0 && report.unmarkedNotes.length > 0) {
    findings.push({
      severity: 'warn',
      workspaceId: ws.id,
      message:
        `Workspace has ${report.unmarkedNotes.length} .md file(s) but no marked project. Add 'markdone: 2' to the ` +
        'frontmatter of every project file and to inbox.md; unmarked files are ordinary notes, not projects',
    });
  }

  const workspace = state.workspaces.find(w => w.config.id === ws.id);
  if (!workspace) return findings;

  const byName = new Map<string, string[]>();
  for (const project of workspace.todoFile.projects) {
    const key = project.name.toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), project.sourcePath ?? project.name]);
  }
  for (const paths of byName.values()) {
    if (paths.length > 1) {
      findings.push({
        severity: 'error',
        workspaceId: ws.id,
        message: `Two projects resolve to the same name (${paths.join(', ')}); address them by project path`,
      });
    }
  }

  const ids = new Set([...report.projects.map(p => p.id), report.inbox?.id ?? 'inbox']);
  const listed = report.defaults?.frontmatter.recognized.projects;
  if (Array.isArray(listed)) {
    for (const entry of listed.map(String)) {
      if (!ids.has(entry)) {
        findings.push({
          severity: 'warn',
          workspaceId: ws.id,
          path: report.defaults!.path,
          message: `projects: entry '${entry}' matches no marked file`,
        });
      }
    }
  }
  return findings;
}

// Workflow findings (`on-complete`), per project in a loaded state.
function lintWorkflow(workspaceId: string, state: AppState): LintFinding[] {
  const workspace = state.workspaces.find(w => w.config.id === workspaceId);
  if (!workspace) return [];
  const findings: LintFinding[] = [];

  workspace.todoFile.projects.forEach((project, projectIndex) => {
    if (project.layout !== 'kanban') return;
    const label = project.sourcePath ?? project.name;
    const resolved = resolveCompletionColumn(project);

    if (resolved.kind === 'unknown') {
      findings.push({
        severity: 'error',
        workspaceId,
        path: project.sourcePath,
        message: `on-complete names column '${resolved.name}', which is not in columns (${label}); the rule is off`,
      });
      return;
    }
    if (resolved.kind !== 'column') return;

    getColumns(project).forEach((column, columnIndex) => {
      if (columnIndex === resolved.index) return;
      getColumnTasks(column).forEach((task, taskIndex) => {
        if (task.checkbox.state !== 'done' && task.checkbox.state !== 'cancelled') return;
        const from = task.blockId
          ? { workspaceId, taskId: task.blockId }
          : { workspaceId, projectIndex, columnIndex, taskIndex };
        findings.push({
          severity: 'info',
          workspaceId,
          path: project.sourcePath,
          message: `${task.checkbox.state === 'done' ? 'Completed' : 'Cancelled'} task "${task.text}" is in '${column.name}', not the on-complete column '${getColumns(project)[resolved.index].name}' (${label})`,
          proposal: {
            operation: 'moveTask',
            input: { from, to: { workspaceId, projectIndex, columnIndex: resolved.index, taskIndex: 0 } },
          },
        });
      });
    });
  });
  return findings;
}

async function lintFileModeMarker(ws: ResolvedWorkspace, fs: FileSystem): Promise<LintFinding[]> {
  const status = ws.handle.markerStatus?.();
  if (status === undefined) return [];
  if (status === 'unsupported' || status === 'unreadable') {
    return [
      {
        severity: 'error',
        workspaceId: ws.id,
        path: ws.path,
        message: "The workspace file's markdone marker is not a supported spec version; it will not be written (report only)",
      },
    ];
  }
  if (status !== 'absent') return [];
  let content = '';
  try {
    content = await fs.read(ws.path);
  } catch {
    return []; // no file yet: nothing to mark
  }
  return [
    {
      severity: 'info',
      workspaceId: ws.id,
      path: ws.path,
      message: "Workspace file has no 'markdone: 2' marker (it still loads: file mode names the file explicitly)",
      fix: addMarkerFix(ws.path, content),
    },
  ];
}

export async function lintWorkspaces(resolved: ResolvedWorkspace[], state: AppState, fs: FileSystem): Promise<LintFinding[]> {
  const findings: LintFinding[] = [];

  for (const ws of resolved) {
    for (const w of ws.handle.warnings()) {
      if (w.code) continue; // reported below as a structured finding
      findings.push({ severity: classifyParserWarning(w.message), workspaceId: ws.id, path: w.path, message: w.message });
    }
    findings.push(...(await lintDefaultsFile(ws, fs)));
    findings.push(...lintDiscovery(ws, state));
    findings.push(...(await lintFileModeMarker(ws, fs)));
    findings.push(...lintWorkflow(ws.id, state));
  }

  for (const { workspaceId, tasks } of collectWorkspaceTasks(state)) {
    const byId = new Map<string, Task[]>();
    for (const task of tasks) {
      if (!task.blockId) continue;
      const list = byId.get(task.blockId) ?? [];
      list.push(task);
      byId.set(task.blockId, list);
    }
    for (const [id, group] of byId) {
      if (group.length > 1) {
        findings.push({ severity: 'error', workspaceId, message: `Duplicate ^${id} (${group.length} tasks share this id)` });
      }
    }

    const knownIds = new Set(byId.keys());
    for (const task of tasks) {
      const dep = getDependency(task);
      if (dep && !knownIds.has(dep)) {
        findings.push({ severity: 'error', workspaceId, message: `"${task.text}" depends on unknown ^${dep} (#after/${dep})` });
      }
      if (task.checkbox.state === 'open' && !task.blockId) {
        findings.push({ severity: 'info', workspaceId, message: `Open task with no ^id: "${task.text}"` });
      }
    }
  }

  return findings;
}

export function effectiveSeverity(finding: LintFinding, strict: boolean): Severity {
  return strict && finding.severity === 'info' ? 'warn' : finding.severity;
}

export function hasBlockingFindings(findings: LintFinding[], strict: boolean): boolean {
  return findings.some(f => effectiveSeverity(f, strict) !== 'info');
}

export function renderLintFindings(findings: LintFinding[], strict: boolean): string {
  if (findings.length === 0) return 'No findings.';
  return findings
    .map(f => {
      const severity = effectiveSeverity(f, strict);
      const loc = [f.workspaceId, f.path].filter(Boolean).join(' ');
      return `[${severity}]${loc ? ` (${loc})` : ''} ${f.message}`;
    })
    .join('\n');
}
