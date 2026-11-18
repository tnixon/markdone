import { Menu, type MarkdownPostProcessorContext } from 'obsidian';
import { getColumns, getColumnTasks, parseCheckboxLine, parseProject, tokenizeTaskLine, type ParseProjectOptions, type Project } from '@markdone/core';
import { applyNoteOperation, type NoteIntent, type NoteResult } from '../noteOps';
import { headingOfLine } from './taskState';

// Reading-view interaction for a note that has already passed the marker
// gate: a click on a checkbox completes/uncompletes the task, a context menu
// and drag-and-drop onto a column heading move it between columns, and each
// column heading carries a count badge.
//
// Matching a rendered item to a source line by ORDER is good enough to
// decorate. It is not good enough to write: so every write re-reads the note,
// requires the line to still be exactly what was rendered, and addresses the
// task by `^id` (see noteOps.ts). On any mismatch nothing is written and the
// user is told.

export const DRAG_MIME = 'application/x-markdone-task';
const SCROLL_EDGE_PX = 50;
const SCROLL_STEP_PX = 20;

// One whole-note parse per (path, text, defaults): Obsidian calls the post
// processor once per rendered section, and a section's parse of the same note
// text is identical, so N sections must not mean N parses.
const PARSE_CACHE_LIMIT = 32;
const parseCache = new Map<string, { text: string; defaultsKey: string; project: Project }>();

function parseNoteCached(path: string, text: string, defaults: ParseProjectOptions['defaults'], fallback: string): Project {
  const defaultsKey = JSON.stringify(defaults ?? null);
  const hit = parseCache.get(path);
  if (hit && hit.text === text && hit.defaultsKey === defaultsKey) return hit.project;
  const { project } = parseProject(text, { filenameFallback: fallback, defaults });
  if (parseCache.size >= PARSE_CACHE_LIMIT) parseCache.delete(parseCache.keys().next().value as string);
  parseCache.set(path, { text, defaultsKey, project });
  return project;
}

export interface InteractionDeps {
  // Defaults inherited from the note's workspace (`_markdone.md`), if any.
  defaultsFor: (path: string) => Promise<ParseProjectOptions['defaults'] | undefined>;
  // Runs one task operation against a note's source line; the plugin's
  // implementation is `applyNoteOperation` bound to the app.
  apply: (path: string, line: number, expectedLine: string, intent: NoteIntent) => Promise<NoteResult>;
  // Called after a write was refused because the file changed underneath it:
  // reload whatever the plugin has cached for that note.
  onConflict: (path: string) => Promise<void> | void;
  notify: (message: string) => void;
}

export function bindNoteApply(app: Parameters<typeof applyNoteOperation>[0], defaultsFor: InteractionDeps['defaultsFor']): InteractionDeps['apply'] {
  return async (path, line, expectedLine, intent) =>
    applyNoteOperation(app, path, { line, expectedLine, intent }, await defaultsFor(path));
}

function normalizeWords(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length >= 3);
}

// A cheap guard against ordinal misalignment (a task-shaped line inside a raw
// HTML block, say): the rendered item's own text must share a word with the
// source line, and its `data-task` marker must agree with the checkbox. The
// strong guard is the fresh-read line equality in noteOps.
function itemMatchesLine(li: HTMLElement, line: string): boolean {
  const cb = parseCheckboxLine(line);
  if (!cb) return false;

  const marker = li.getAttribute('data-task');
  if (marker !== null) {
    const renderedMarker = marker === '' ? ' ' : marker;
    if (renderedMarker.toLowerCase() !== cb.checkbox.marker.toLowerCase()) return false;
  }

  const sourceWords = normalizeWords(tokenizeTaskLine(cb.rest).text);
  if (sourceWords.length === 0) return true;
  const ownText = Array.from(li.childNodes)
    .filter(node => !(node instanceof HTMLElement && (node.tagName === 'UL' || node.tagName === 'OL')))
    .map(node => node.textContent ?? '')
    .join(' ')
    .toLowerCase();
  return sourceWords.some(word => ownText.includes(word));
}

interface DragPayload {
  path: string;
  line: number;
  expectedLine: string;
}

function readPayload(evt: DragEvent): DragPayload | undefined {
  const raw = evt.dataTransfer?.getData(DRAG_MIME);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as DragPayload;
  } catch {
    return undefined;
  }
}

function hasMarkdoneDrag(evt: DragEvent): boolean {
  return Array.from(evt.dataTransfer?.types ?? []).includes(DRAG_MIME);
}

// Counts per column, from a whole-file parse — never from the rendered
// section, which may hold only part of the note.
export function columnCounts(project: Project): Map<string, { open: number; done: number; cancelled: number }> {
  const counts = new Map<string, { open: number; done: number; cancelled: number }>();
  if (project.layout !== 'kanban') return counts;
  for (const column of getColumns(project)) {
    const tally = { open: 0, done: 0, cancelled: 0 };
    for (const task of getColumnTasks(column)) {
      if (task.checkbox.state === 'open') tally.open++;
      else if (task.checkbox.state === 'done') tally.done++;
      else if (task.checkbox.state === 'cancelled') tally.cancelled++;
    }
    counts.set(column.name.trim().toLowerCase(), tally);
  }
  return counts;
}

export function formatCounts(tally: { open: number; done: number; cancelled: number }): string {
  const parts = [`${tally.open} open`, `${tally.done} done`];
  if (tally.cancelled > 0) parts.push(`${tally.cancelled} cancelled`);
  return parts.join(' · ');
}

// In a marked note Obsidian's own checkbox toggle edits the file directly,
// bypassing the workflow rules — so a checkbox this code can't safely map to a
// source line must be stopped, not left to the native toggle.
function blockUnmappedCheckboxes(el: HTMLElement, notify: (message: string) => void, message: string): void {
  el.addEventListener(
    'click',
    evt => {
      const target = evt.target as HTMLElement | null;
      if (!target || target.tagName !== 'INPUT' || !target.classList.contains('task-list-item-checkbox')) return;
      evt.preventDefault();
      evt.stopPropagation();
      notify(message);
    },
    true,
  );
}

export async function enhanceMarkdoneNote(el: HTMLElement, ctx: MarkdownPostProcessorContext, deps: InteractionDeps): Promise<void> {
  const info = ctx.getSectionInfo(el);
  if (!info) {
    // An embed or hover preview: there is no source line to address, and the
    // native toggle would write around core.
    blockUnmappedCheckboxes(el, deps.notify, 'Markdone: open this note to check tasks off — nothing was written');
    return;
  }
  const path = ctx.sourcePath;
  const allLines = info.text.split('\n');

  const defaults = await deps.defaultsFor(path);
  const stem = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/i, '');
  const project = parseNoteCached(path, info.text, defaults, stem);
  const columns = project.layout === 'kanban' ? getColumns(project) : [];
  const columnNames = columns.map(c => c.name);
  const counts = columnCounts(project);

  // Column headings: count badge + drop target.
  for (const heading of Array.from(el.querySelectorAll<HTMLElement>('h2'))) {
    const name = (heading.getAttribute('data-heading') ?? heading.textContent ?? '').trim();
    const tally = counts.get(name.toLowerCase());
    if (!tally) continue;

    // Idempotent: a post processor can run twice on the same element.
    if (heading.querySelector('.markdone-column-count')) continue;
    const badge = heading.ownerDocument.createElement('span');
    badge.className = 'markdone-column-count';
    badge.textContent = formatCounts(tally);
    heading.append(badge);

    heading.addEventListener('dragover', evt => {
      if (hasMarkdoneDrag(evt)) evt.preventDefault();
    });
    heading.addEventListener('drop', evt => {
      const payload = readPayload(evt);
      if (!payload || payload.path !== path) return;
      evt.preventDefault();
      void runIntent(deps, path, payload.line, payload.expectedLine, { kind: 'move', columnName: name });
    });
  }

  // Task items: line addressing, drag source.
  const taskLines: number[] = [];
  for (let n = info.lineStart; n <= info.lineEnd; n++) {
    if (parseCheckboxLine(allLines[n] ?? '') !== null) taskLines.push(n);
  }
  const items = Array.from(el.querySelectorAll<HTMLElement>('li.task-list-item'));
  items.forEach((li, i) => {
    const lineNumber = taskLines[i];
    if (lineNumber === undefined) return;
    li.dataset.markdoneLine = String(lineNumber);

    const topLevel = parseCheckboxLine(allLines[lineNumber])?.indent === '';
    if (columns.length > 0 && topLevel) {
      li.draggable = true;
      li.addEventListener('dragstart', evt => {
        if (!evt.dataTransfer) return;
        const payload: DragPayload = { path, line: lineNumber, expectedLine: allLines[lineNumber] };
        evt.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
        evt.dataTransfer.effectAllowed = 'move';
        startAutoScroll(li);
      });
    }
  });

  // Click on a checkbox. Capture phase on the section root so it runs before
  // Obsidian's own toggle, which is then stopped — otherwise both would write.
  el.addEventListener(
    'click',
    evt => {
      const target = evt.target as HTMLElement | null;
      if (!target || target.tagName !== 'INPUT' || !target.classList.contains('task-list-item-checkbox')) return;
      const li = target.closest<HTMLElement>('li.task-list-item');
      const lineAttr = li?.dataset.markdoneLine;

      // Always stop the native toggle in a marked note, mapped or not.
      evt.preventDefault();
      evt.stopPropagation();
      if (!li || lineAttr === undefined) {
        deps.notify("Markdone: couldn't match this item to its line in the note — nothing was written");
        return;
      }

      const lineNumber = Number(lineAttr);
      const line = allLines[lineNumber];
      const cb = parseCheckboxLine(line);
      if (!cb) return;
      // A cancelled task stays cancelled, and a foreign marker has no meaning
      // here: the click does nothing.
      if (cb.checkbox.state !== 'open' && cb.checkbox.state !== 'done') return;
      if (!itemMatchesLine(li, line)) {
        deps.notify("Markdone: couldn't match this item to its line in the note — nothing was written");
        return;
      }
      const kind = cb.checkbox.state === 'open' ? 'complete' : 'uncomplete';
      void runIntent(deps, path, lineNumber, line, { kind });
    },
    true,
  );

  // Context menu (right-click on desktop, long-press on mobile).
  if (columns.length > 0) {
    el.addEventListener('contextmenu', evt => {
      const li = (evt.target as HTMLElement | null)?.closest<HTMLElement>('li.task-list-item');
      const lineAttr = li?.dataset.markdoneLine;
      if (!li || lineAttr === undefined) return;
      const lineNumber = Number(lineAttr);
      const line = allLines[lineNumber];
      if (parseCheckboxLine(line)?.indent !== '') return; // subtasks move with their parent

      evt.preventDefault();
      const here = headingOfLine(allLines, lineNumber)?.toLowerCase();
      const menu = new Menu();
      for (const name of columnNames) {
        if (name.trim().toLowerCase() === here) continue;
        menu.addItem(item =>
          item.setTitle(`Move to → ${name}`).onClick(() => {
            void runIntent(deps, path, lineNumber, line, { kind: 'move', columnName: name });
          }),
        );
      }
      menu.showAtMouseEvent(evt);
    });
  }
}

async function runIntent(deps: InteractionDeps, path: string, line: number, expectedLine: string, intent: NoteIntent): Promise<void> {
  const result = await deps.apply(path, line, expectedLine, intent);
  if (result.ok) return;
  if (result.conflict) {
    await deps.onConflict(path);
    deps.notify('Markdone: the note was changed by something else — reloaded, nothing was written. Try again.');
    return;
  }
  deps.notify(`Markdone: ${result.message}`);
}

// While a task is being dragged, scroll the preview when the pointer nears
// its top or bottom edge, so a column heading far from the task is reachable.
function startAutoScroll(from: HTMLElement): void {
  const container = from.closest<HTMLElement>('.markdown-preview-view') ?? from.ownerDocument.scrollingElement;
  if (!container) return;
  const onDragOver = (evt: DragEvent) => {
    const rect = (container as HTMLElement).getBoundingClientRect();
    if (evt.clientY - rect.top < SCROLL_EDGE_PX) container.scrollTop -= SCROLL_STEP_PX;
    else if (rect.bottom - evt.clientY < SCROLL_EDGE_PX) container.scrollTop += SCROLL_STEP_PX;
  };
  // `dragend` fires on the source element, which a re-render mid-drag can
  // detach; the document-level listener and `drop` are the backstops, so the
  // container's `dragover` listener never leaks.
  const doc = from.ownerDocument;
  const stop = () => {
    container.removeEventListener('dragover', onDragOver as EventListener);
    container.removeEventListener('drop', stop);
    from.removeEventListener('dragend', stop);
    doc.removeEventListener('dragend', stop, true);
  };
  container.addEventListener('dragover', onDragOver as EventListener);
  container.addEventListener('drop', stop);
  from.addEventListener('dragend', stop);
  doc.addEventListener('dragend', stop, true);
}


