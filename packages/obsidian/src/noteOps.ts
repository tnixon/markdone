import { TFile, type App } from 'obsidian';
import {
  generateBlockId,
  getColumns,
  getColumnTasks,
  getOperation,
  parseCheckboxLine,
  parseFrontmatter,
  parseProject,
  serializeProject,
  tokenizeTaskLine,
  type AppState,
  type ParseProjectOptions,
} from '@markdone/core';
import { writePreviewedChanges } from './write';

// Task operations on ONE note, addressed by a source line — the engine behind
// Reading-view clicks, menu moves, and drops. The caller supplies the line
// text it believes is there (taken from the rendered section); the note is
// re-read fresh and the operation proceeds only if that exact line is still
// there. The task is then addressed by `^id`, assigned in the same write
// when the line has none. A mismatch writes nothing.

export type NoteIntent =
  | { kind: 'complete' }
  | { kind: 'uncomplete' }
  | { kind: 'move'; columnName: string };

export interface NoteRequest {
  // 0-based index of the task line in the note.
  line: number;
  // The line's text as the caller saw it when it was rendered.
  expectedLine: string;
  intent: NoteIntent;
}

export type NotePlan = { ok: true; before: string; after: string } | { ok: false; message: string };

const NOTE_WORKSPACE_ID = 'note';

// Pure: computes the note's new text for a request, or why it can't.
export function planNoteOperation(
  original: string,
  request: NoteRequest,
  fallbackName: string,
  defaults?: ParseProjectOptions['defaults'],
): NotePlan {
  // Plan on LF text and restore the note's own line ending afterward, so a
  // CRLF note never ends up with mixed endings (and its frontmatter, which
  // the parser only recognizes LF-delimited, is read at all).
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const content = eol === '\r\n' ? original.replace(/\r\n/g, '\n') : original;
  const expectedLine = request.expectedLine.replace(/\r$/, '');

  const lines = content.split('\n');
  const current = lines[request.line];
  if (current === undefined || current !== expectedLine) {
    return { ok: false, message: 'this note changed since it was rendered — nothing was written' };
  }
  const checkbox = parseCheckboxLine(current);
  if (!checkbox) return { ok: false, message: 'that line is no longer a task — nothing was written' };

  // Address by ^id; assign one in this same write if the line has none.
  const existingId = tokenizeTaskLine(checkbox.rest).blockId;
  const taskId = existingId ?? generateBlockId(new Set());
  if (!existingId) lines[request.line] = `${current.trimEnd()} ^${taskId}`;
  const withId = lines.join('\n');

  const { project } = parseProject(withId, { filenameFallback: fallbackName, defaults });
  const state: AppState = {
    workspaces: [
      {
        config: { id: NOTE_WORKSPACE_ID, name: fallbackName, filePath: fallbackName },
        todoFile: { frontmatter: { raw: '', recognized: {}, unknown: {}, present: false }, preamble: [], projects: [project] },
      },
    ],
    activeScope: NOTE_WORKSPACE_ID,
  };
  const address = { workspaceId: NOTE_WORKSPACE_ID, taskId };

  let operationName: string;
  let input: Record<string, unknown>;
  if (request.intent.kind === 'move') {
    if (project.layout !== 'kanban') return { ok: false, message: 'this note is not a kanban board' };
    const wanted = request.intent.columnName.trim().toLowerCase();
    const columns = getColumns(project);
    const columnIndex = columns.findIndex(c => c.name.trim().toLowerCase() === wanted);
    if (columnIndex === -1) return { ok: false, message: `no column named "${request.intent.columnName}"` };
    operationName = 'moveTask';
    input = {
      from: address,
      to: { workspaceId: NOTE_WORKSPACE_ID, projectIndex: 0, columnIndex, taskIndex: getColumnTasks(columns[columnIndex]).length },
    };
  } else {
    operationName = request.intent.kind === 'complete' ? 'completeTask' : 'uncompleteTask';
    input = { location: address };
  }

  const operation = getOperation(operationName)!;
  const result = operation.execute(state, input) as { ok: true; value: AppState } | { ok: false; error: { message: string } };
  if (!result.ok) return { ok: false, message: result.error.message };

  const serialized = serializeProject(result.value.workspaces[0].todoFile.projects[0]);
  const after = eol === '\r\n' ? serialized.replace(/\n/g, '\r\n') : serialized;
  return { ok: true, before: original, after };
}

export type NoteResult = { ok: true } | { ok: false; message: string; conflict?: boolean };

// Reads the note fresh, plans, and writes through the plugin's guarded write
// path (`vault.process`, re-checking the live content against what the plan
// was computed from).
export async function applyNoteOperation(
  app: App,
  path: string,
  request: NoteRequest,
  defaults?: ParseProjectOptions['defaults'],
): Promise<NoteResult> {
  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return { ok: false, message: `"${path}" is not a note in this vault` };

  const before = await app.vault.read(file);
  const stem = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '');
  const plan = planNoteOperation(before, request, stem, defaults);
  if (!plan.ok) return plan;

  const [outcome] = await writePreviewedChanges(app, [{ path, before: plan.before, after: plan.after }]);
  if (!outcome.applied) return { ok: false, message: outcome.reason ?? `failed to write "${path}"`, conflict: outcome.conflict };
  return { ok: true };
}

// The workspace defaults a note inherits (`_markdone.md` in the configured
// workspace folder containing it), so a note's layout/columns/on-complete
// resolve the way core's loader resolves them. None for a note outside every
// configured folder.
export async function loadDefaultsFor(
  app: App,
  folders: string[],
  notePath: string,
): Promise<ParseProjectOptions['defaults'] | undefined> {
  const folder = folders.find(f => notePath.startsWith(`${f}/`));
  if (!folder) return undefined;
  const defaultsFile = app.vault.getAbstractFileByPath(`${folder}/_markdone.md`);
  if (!(defaultsFile instanceof TFile)) return undefined;

  // cachedRead: this runs once per rendered section, so it must not hit disk
  // each time.
  const { frontmatter } = parseFrontmatter(await app.vault.cachedRead(defaultsFile));
  const r = frontmatter.recognized;
  return {
    layout: r.layout === 'kanban' ? 'kanban' : r.layout === 'checklist' ? 'checklist' : undefined,
    columns: Array.isArray(r.columns) ? r.columns.map(String) : undefined,
    owner: typeof r.owner === 'string' ? r.owner : undefined,
    priority: typeof r.priority === 'number' ? r.priority : undefined,
    onComplete: typeof r['on-complete'] === 'string' ? (r['on-complete'] as string) : undefined,
  };
}
