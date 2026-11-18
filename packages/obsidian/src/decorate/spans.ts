import { locateTaskLineTokens, parseCheckboxLine, tokenizeTaskLine, slackDays, type TaskLineToken } from '@markdone/core';

// The chip types the settings tab offers show/hide toggles for. Deliberately
// NOT `TaskLineToken['kind']` — that also includes 'tag' (which covers every
// plain #label and every other nested tag, none of which Markdone chips —
// see `chipKindFor`) and 'blockId' (never chipped at all: nothing in the
// MVP scope asks for it, and Obsidian already renders `^id` unobtrusively).
export type ChipKind = 'due' | 'defer' | 'context' | 'value' | 'complexity' | 'effort' | 'actual' | 'owner' | 'waiting';

export const CHIP_KINDS: readonly ChipKind[] = [
  'due',
  'defer',
  'context',
  'value',
  'complexity',
  'effort',
  'actual',
  'owner',
  'waiting',
];

export type ChipSettings = Record<ChipKind, boolean>;

export interface Chip {
  start: number;
  end: number;
  kind: ChipKind;
  cssClass: string;
}

// A generic #tag and every OTHER nested tag (#sprint/4, #genre/productivity,
// ...) are left entirely to Obsidian's own tag handling — chipping them
// would duplicate what Obsidian already renders and risks visually
// colliding with it. `#owner/` and `#waiting/` are the two reserved nested
// tags this plugin decorates.
export function chipKindFor(token: TaskLineToken): ChipKind | undefined {
  switch (token.kind) {
    case 'due':
    case 'defer':
    case 'context':
    case 'value':
    case 'complexity':
    case 'effort':
    case 'actual':
      return token.kind;
    case 'tag':
      return token.key === 'owner' || token.key === 'waiting' ? token.key : undefined;
    default:
      return undefined; // blockId, and any tag that isn't owner/waiting
  }
}

// Chips for one task line's body (the text after "- [x] "), gated by the
// settings tab's show/hide toggles. A malformed token (`valid: false`) is
// never chipped — per spec it's still description text, so it renders as
// plain text, unchanged.
export function chipsForLine(body: string, enabled: ChipSettings): Chip[] {
  const chips: Chip[] = [];
  for (const token of locateTaskLineTokens(body)) {
    if (!token.valid) continue;
    const kind = chipKindFor(token);
    if (!kind || !enabled[kind]) continue;
    chips.push({ start: token.start, end: token.end, kind, cssClass: `markdone-token markdone-token--${kind}` });
  }
  return chips;
}

export type Cue = 'overdue' | 'negative-slack' | undefined;

// The one visual cue the MVP asks for: a task past its due date, or one
// whose remaining slack (spec "Prioritization Model": due date minus effort)
// has already gone negative even though the deadline itself hasn't passed
// yet. Only meaningful for an OPEN task — a done or cancelled task isn't
// something to flag as urgent.
export function cueForTaskLine(rawLine: string, todayIso: string): Cue {
  const cb = parseCheckboxLine(rawLine);
  if (!cb || cb.checkbox.state !== 'open') return undefined;

  const result = tokenizeTaskLine(cb.rest);
  if (result.dueDate === undefined) return undefined;
  if (result.dueDate < todayIso) return 'overdue';
  if (result.effort !== undefined && slackDays(result.dueDate, result.effort, todayIso) < 0) {
    return 'negative-slack';
  }
  return undefined;
}
