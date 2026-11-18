import { RangeSetBuilder, StateEffect } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type PluginSpec, type PluginValue, type ViewUpdate } from '@codemirror/view';
import { parseCheckboxLine } from '@markdone/core';
import { chipsForLine, cueForTaskLine, type ChipSettings } from './spans';

// Dispatched into every open editor when the settings tab's chip-type
// toggles change, so decorations update immediately rather than only on the
// next edit or scroll. `ViewUpdate.docChanged`/`viewportChanged` don't fire
// for a settings change, so without this the toggle would need a reopen.
export const markdoneSettingsChanged = StateEffect.define<void>();

export function refreshMarkdoneDecorations(view: EditorView): void {
  view.dispatch({ effects: [markdoneSettingsChanged.of()] });
}

export interface LineDecorationSpan {
  from: number;
  to: number;
  type: 'mark' | 'line';
  cssClass: string;
}

// The line→ranges mapping, factored out from the CM6 builder plumbing below
// so it's testable with plain strings and numbers — no EditorView, no DOM.
// Ordered so a caller feeding these straight into a RangeSetBuilder in
// order never violates its non-decreasing-position requirement: the line
// decoration (position = the line's own start) always sorts before every
// chip's position (strictly inside the line body, after it).
export function computeLineDecorations(
  lineText: string,
  lineStart: number,
  settings: ChipSettings,
  todayIso: string,
): LineDecorationSpan[] {
  const cb = parseCheckboxLine(lineText);
  if (!cb) return [];

  const spans: LineDecorationSpan[] = [];

  const cue = cueForTaskLine(lineText, todayIso);
  if (cue) {
    spans.push({ from: lineStart, to: lineStart, type: 'line', cssClass: `markdone-line markdone-line--${cue}` });
  }

  const bodyStart = lineStart + cb.indent.length + '- [x] '.length;
  for (const chip of chipsForLine(cb.rest, settings)) {
    spans.push({ from: bodyStart + chip.start, to: bodyStart + chip.end, type: 'mark', cssClass: chip.cssClass });
  }

  return spans;
}

function buildDecorations(view: EditorView, settings: ChipSettings, todayIso: string): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      for (const span of computeLineDecorations(line.text, line.from, settings, todayIso)) {
        const decoration = span.type === 'line' ? Decoration.line({ class: span.cssClass }) : Decoration.mark({ class: span.cssClass });
        builder.add(span.from, span.to, decoration);
      }
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

// A mark decoration (never `replace`/a widget): it restyles the existing
// characters in place, so the underlying markdown is unchanged, still
// selectable, and still editable — there's no "unrender while the cursor is
// on this line" dance a widget would need. Rebuilds only on doc/viewport
// change or an explicit settings-changed effect, and only scans
// `view.visibleRanges` — never the whole document.
//
// `isMarkdoneNote` is the same gate Reading view uses: an editor whose note
// has no supported `markdone` marker gets no decorations at all.
export function createMarkdoneViewPlugin(
  getSettings: () => ChipSettings,
  getTodayIso: () => string,
  isMarkdoneNote: (view: EditorView) => boolean = () => true,
) {
  class MarkdoneViewPlugin implements PluginValue {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = isMarkdoneNote(view) ? buildDecorations(view, getSettings(), getTodayIso()) : Decoration.none;
    }

    update(update: ViewUpdate): void {
      const settingsChanged = update.transactions.some(tr => tr.effects.some(e => e.is(markdoneSettingsChanged)));
      if (update.docChanged || update.viewportChanged || settingsChanged) {
        this.decorations = isMarkdoneNote(update.view)
          ? buildDecorations(update.view, getSettings(), getTodayIso())
          : Decoration.none;
      }
    }

    destroy(): void {}
  }

  const spec: PluginSpec<MarkdoneViewPlugin> = {
    decorations: value => value.decorations,
  };

  return ViewPlugin.fromClass(MarkdoneViewPlugin, spec);
}
