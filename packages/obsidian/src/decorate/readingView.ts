import type { MarkdownPostProcessorContext } from 'obsidian';
import { parseCheckboxLine } from '@markdone/core';
import { chipsForLine, cueForTaskLine, type Chip, type ChipSettings } from './spans';
import { headingOfLine, taskItemState } from './taskState';

// Obsidian has already turned every `#word` sequence into `<a class="tag">`
// by the time a post processor runs — native tags and Markdone's reserved
// `#owner/`/`#waiting/` nested tags alike. So unlike Live Preview (which
// decorates raw text), reading view needs two passes: add a class to the
// tag anchors that are ours, and separately scan the remaining plain text
// for the sigil tokens Obsidian leaves untouched (! > @ $ % ~ &).
const SKIP_TAG_NAMES = new Set(['CODE', 'A']);

function decorateTagAnchors(li: HTMLElement, settings: ChipSettings): void {
  li.querySelectorAll<HTMLAnchorElement>('a.tag').forEach(a => {
    const match = (a.textContent ?? '').match(/^#(owner|waiting)\//);
    if (!match) return;
    const kind = match[1] as 'owner' | 'waiting';
    if (!settings[kind]) return;
    a.classList.add('markdone-token', `markdone-token--${kind}`);
  });
}

// Replaces a text node with a mix of plain text and `<span>` chips per the
// located spans — the DOM equivalent of Live Preview's mark decorations.
function wrapChipsInTextNode(node: Text, text: string, chips: Chip[]): void {
  const doc = node.ownerDocument;
  const fragment = doc.createDocumentFragment();
  let cursor = 0;
  for (const chip of chips) {
    if (chip.start > cursor) fragment.append(doc.createTextNode(text.slice(cursor, chip.start)));
    const span = doc.createElement('span');
    span.className = chip.cssClass;
    span.textContent = text.slice(chip.start, chip.end);
    fragment.append(span);
    cursor = chip.end;
  }
  if (cursor < text.length) fragment.append(doc.createTextNode(text.slice(cursor)));
  node.replaceWith(fragment);
}

function decorateTextTokens(li: HTMLElement, settings: ChipSettings): void {
  const doc = li.ownerDocument;
  const walker = doc.createTreeWalker(li, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parentTag = node.parentElement?.tagName;
      return parentTag && SKIP_TAG_NAMES.has(parentTag) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
    },
  });

  // Collect nodes before mutating — replacing a node mid-walk would confuse
  // the TreeWalker.
  const textNodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    textNodes.push(node as Text);
  }

  for (const node of textNodes) {
    const text = node.textContent ?? '';
    // #owner/#waiting are handled by decorateTagAnchors above — Obsidian has
    // already moved them into <a class="tag"> elements, out of this text.
    const chips = chipsForLine(text, settings).filter(c => c.kind !== 'owner' && c.kind !== 'waiting');
    if (chips.length > 0) wrapChipsInTextNode(node, text, chips);
  }
}

function applyCue(li: HTMLElement, sourceLine: string, todayIso: string): void {
  const cue = cueForTaskLine(sourceLine, todayIso);
  if (cue) li.classList.add('markdone-line', `markdone-line--${cue}`);
}

// Styling hooks on each task item: data attributes (status, column, waiting,
// deferred, context) for CSS snippets and themes to target, plus classes for
// the four states, alongside the overdue cue above.
function applyStateHooks(li: HTMLElement, sourceLine: string, column: string | undefined, todayIso: string): void {
  const state = taskItemState(sourceLine, todayIso);
  if (!state) return;
  li.dataset.markdoneStatus = state.status === 'done' ? 'done' : state.status === 'cancelled' ? 'cancelled' : 'open';
  if (column !== undefined) li.dataset.markdoneColumn = column;
  if (state.waiting) li.dataset.markdoneWaiting = 'true';
  if (state.deferred) li.dataset.markdoneDeferred = 'true';
  if (state.contexts.length > 0) li.dataset.markdoneContext = state.contexts.join(' ');

  li.classList.add('markdone-task');
  if (state.status === 'done') li.classList.add('markdone-line--done');
  if (state.status === 'cancelled') li.classList.add('markdone-line--cancelled');
  if (state.waiting) li.classList.add('markdone-line--waiting');
  if (state.deferred) li.classList.add('markdone-line--deferred');
}

// Registered via `Plugin.registerMarkdownPostProcessor`. Correlates each
// rendered `<li class="task-list-item">` to its source line by order — both
// list documents and rendering preserve document order, so the Nth task
// line in the section's source is the Nth rendered task-list item. This is
// a best-effort correlation, not a guaranteed one (an unusual document with
// task-shaped lines inside a raw HTML block could throw it off), but it
// covers every ordinary Markdone note.
export function decorateReadingView(
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
  settings: ChipSettings,
  todayIso: string,
  // The gate: only a note with a supported `markdone` marker is decorated.
  // Omitted by callers that have already checked.
  isMarkdoneNote?: (sourcePath: string) => boolean,
): void {
  if (isMarkdoneNote && !isMarkdoneNote(ctx.sourcePath)) return;

  const items = Array.from(el.querySelectorAll<HTMLElement>('li.task-list-item'));
  if (items.length === 0) return;

  const sectionInfo = ctx.getSectionInfo(el);
  const allLines = sectionInfo ? sectionInfo.text.split('\n') : [];
  const taskLineNumbers: number[] = [];
  if (sectionInfo) {
    for (let n = sectionInfo.lineStart; n <= sectionInfo.lineEnd; n++) {
      if (parseCheckboxLine(allLines[n] ?? '') !== null) taskLineNumbers.push(n);
    }
  }

  items.forEach((li, i) => {
    decorateTagAnchors(li, settings);
    decorateTextTokens(li, settings);
    const lineNumber = taskLineNumbers[i];
    if (lineNumber === undefined) return;
    const sourceLine = allLines[lineNumber];
    applyCue(li, sourceLine, todayIso);
    applyStateHooks(li, sourceLine, headingOfLine(allLines, lineNumber), todayIso);
  });
}
