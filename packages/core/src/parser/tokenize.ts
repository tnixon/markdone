// Per-line tokenizer: turns the text of a task line (after the checkbox)
// into a description plus metadata tokens, per TODO_FORMAT.md v2.

import type { Actual, Checkbox, CheckboxState, Effort, Tag } from '../model/types';

export interface TokenizeResult {
  text: string;
  dueDate?: string;
  deferDate?: string;
  contexts: string[];
  value?: number;
  complexity?: number;
  effort?: Effort;
  actual?: Actual;
  tags: Tag[];
  blockId?: string;
  warnings: string[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/;

export function parseEffort(raw: string): Effort | null {
  const match = raw.match(/^(\d+(?:\.\d+)?)(min|hrs|days|wks)$/);
  if (!match) return null;
  return { amount: parseFloat(match[1]), unit: match[2] as Effort['unit'] };
}

export function parseActual(raw: string): Actual | null {
  // &(date) | &(date):duration | &(start, end) | &(start, end):duration
  const match = raw.match(/^\(([^)]+)\)(?::(.+))?$/);
  if (!match) return null;

  const inner = match[1];
  const durationStr = match[2];
  const parts = inner.split(',').map(s => s.trim());
  if (parts.length > 2 || parts.some(p => p === '')) return null;

  let completionDate: string;
  let startDate: string | undefined;
  if (parts.length === 2) {
    [startDate, completionDate] = parts;
  } else {
    completionDate = parts[0];
  }

  const actual: Actual = { completionDate };
  if (startDate) actual.startDate = startDate;
  if (durationStr) {
    const effort = parseEffort(durationStr);
    if (effort) actual.duration = effort; // an invalid duration is dropped silently, per spec
  }
  return actual;
}

// --- checkbox ---

const CHECKBOX_LINE_RE = /^(\s*)- \[(.)\] (.*)$/;

export interface CheckboxLine {
  indent: string;
  checkbox: Checkbox;
  rest: string;
}

// A task line requires the strict `- [x] ` shape (single char, one
// trailing space). Anything else — including a checkbox with no following
// space — is not recognized as a task line at all and is preserved as
// opaque content instead of being force-fit into a bogus Task, which is
// what v1 did.
export function parseCheckboxLine(line: string): CheckboxLine | null {
  const match = line.match(CHECKBOX_LINE_RE);
  if (!match) return null;
  const [, indent, marker, rest] = match;
  let state: CheckboxState;
  if (marker === ' ') state = 'open';
  else if (marker === 'x' || marker === 'X') state = 'done';
  else if (marker === '-') state = 'cancelled';
  else state = 'other';
  const canonicalMarker = state === 'done' ? 'x' : marker;
  return { indent, checkbox: { state, marker: canonicalMarker }, rest };
}

// --- protected spans: wikilinks, embeds, inline code ---
// Their content is never scanned for tokens. Order matters: embeds
// (![[...]]) before plain wikilinks ([[...]]), since the wikilink pattern
// would otherwise also match inside an embed's brackets.
const PROTECTED_PATTERNS = [/`[^`]*`/g, /!\[\[[^\]]*\]\]/g, /\[\[[^\]]*\]\]/g];

function maskProtectedSpans(line: string): string {
  let masked = line;
  for (const pattern of PROTECTED_PATTERNS) {
    masked = masked.replace(pattern, m => 'x'.repeat(m.length));
  }
  return masked;
}

// The master token pattern — also reused by the serializer to detect
// description substrings that need escaping. Boundary is enforced by the
// caller on both sides (leading via lookbehind + explicit check; trailing
// via an explicit check after each match), since a lookahead alone can't
// express "whitespace or end of string" as cleanly as re-checking the
// following character.
export const TOKEN_PATTERN =
  /(?<![^\s])(!(\S+)|>(\S+)|@([A-Za-z0-9_-]+)|\$(\d+(?:\.\d+)?)|%(\d+(?:\.\d+)?)|~(\S+)|\*(\S+)|&(\([^)]+\)(?::\S+)?)|#([A-Za-z0-9_/-]+)(?:\(([^)]*)\))?)/g;

// `^id` must be the last thing on the line (spec: Block IDs). Shared by
// `tokenizeTaskLine` and `locateTaskLineTokens` so the two agree on exactly
// where a block id starts and ends.
const BLOCK_ID_RE = /(?:^|\s)\^([A-Za-z0-9-]{1,64})$/;

interface RawTokenMatch {
  start: number;
  end: number;
  match: RegExpMatchArray;
}

// Scans `line` (already stripped of any trailing `^id`) for token-shaped
// matches with a whitespace-or-line-edge boundary enforced on both sides,
// over a version of the line with wikilinks/embeds/code spans masked out.
// This is the one place `TOKEN_PATTERN` is applied to a task line's body:
// both `tokenizeTaskLine` (the full structured parse) and
// `locateTaskLineTokens` (character spans, for editor decoration) fold over
// its output, so the two can never disagree about what is or isn't a token.
function scanRawTokenMatches(line: string): RawTokenMatch[] {
  const masked = maskProtectedSpans(line);
  const matches: RawTokenMatch[] = [];
  for (const match of masked.matchAll(TOKEN_PATTERN)) {
    const start = match.index!;
    if (start > 0 && !/\s/.test(masked[start - 1])) continue;
    const end = start + match[0].length;
    if (end < masked.length && !/\s/.test(masked[end])) continue;
    matches.push({ start, end, match });
  }
  return matches;
}

// A character span for one token on a task line, for a consumer that wants
// to decorate or highlight tokens in place (e.g. an editor extension)
// without re-implementing the tokenizer's boundary rules, protected-span
// masking, or deprecation/validity classification. `start`/`end` are
// offsets into the same string passed to `locateTaskLineTokens` — the task
// body, i.e. what `tokenizeTaskLine` also takes.
export interface TaskLineToken {
  kind: 'due' | 'defer' | 'context' | 'value' | 'complexity' | 'effort' | 'actual' | 'tag' | 'blockId';
  start: number;
  end: number;
  // false for a token shape that failed its own grammar (a malformed date,
  // an unrecognized effort unit, a purely-numeric "tag") — per spec such a
  // span stays part of the description text rather than becoming metadata.
  valid: boolean;
  // *2hrs, #key(value), @waiting — recognized but superseded by v2 syntax.
  deprecated: boolean;
  // The key of a nested tag (`#owner/alice` → `owner`). Undefined for a
  // plain label tag and for every non-tag kind.
  key?: string;
}

function classifyRawMatch({ start, end, match }: RawTokenMatch): TaskLineToken {
  const [, , dateVal, deferVal, ctxVal, valStr, cmpxStr, tildeEffortStr, starEffortStr, actualStr, tagName, tagVal] =
    match;
  const span = { start, end };

  if (dateVal !== undefined) return { ...span, kind: 'due', valid: DATE_RE.test(dateVal), deprecated: false };
  if (deferVal !== undefined) return { ...span, kind: 'defer', valid: DATE_RE.test(deferVal), deprecated: false };
  if (ctxVal !== undefined) return { ...span, kind: 'context', valid: true, deprecated: ctxVal === 'waiting' };
  if (valStr !== undefined) return { ...span, kind: 'value', valid: true, deprecated: false };
  if (cmpxStr !== undefined) return { ...span, kind: 'complexity', valid: true, deprecated: false };
  if (tildeEffortStr !== undefined) {
    return { ...span, kind: 'effort', valid: parseEffort(tildeEffortStr) !== null, deprecated: false };
  }
  if (starEffortStr !== undefined) {
    return { ...span, kind: 'effort', valid: parseEffort(starEffortStr) !== null, deprecated: true };
  }
  if (actualStr !== undefined) return { ...span, kind: 'actual', valid: parseActual(actualStr) !== null, deprecated: false };
  // tagName !== undefined — the pattern's last alternative.
  if (/^\d+$/.test(tagName)) return { ...span, kind: 'tag', valid: false, deprecated: false };
  if (tagVal !== undefined) return { ...span, kind: 'tag', valid: true, deprecated: true, key: tagName };
  if (tagName.includes('/')) {
    return { ...span, kind: 'tag', valid: true, deprecated: false, key: tagName.slice(0, tagName.indexOf('/')) };
  }
  return { ...span, kind: 'tag', valid: true, deprecated: false };
}

// Locates every token on a task line — everything `tokenizeTaskLine` reads,
// as character spans instead of parsed values. `rawLine` is the same string
// `tokenizeTaskLine` takes (the task body, after the checkbox). Intended for
// a consumer that renders the line rather than storing it — e.g. an editor
// decoration pass — so it never needs its own copy of the token grammar,
// the protected-span rules, or the deprecation list.
export function locateTaskLineTokens(rawLine: string): TaskLineToken[] {
  const idMatch = rawLine.match(BLOCK_ID_RE);
  const scanLine = idMatch ? rawLine.slice(0, idMatch.index) : rawLine;
  const tokens = scanRawTokenMatches(scanLine).map(classifyRawMatch);
  if (idMatch) {
    tokens.push({
      kind: 'blockId',
      start: rawLine.length - 1 - idMatch[1].length,
      end: rawLine.length,
      valid: true,
      deprecated: false,
    });
  }
  return tokens;
}

function unescapeText(text: string): string {
  return text.replace(/\\([!>@$%~&#^])/g, '$1');
}

// Escapes any substring of `text` that would tokenize on a future parse,
// so a conforming serializer never emits a description that silently grows
// metadata on the next read. Wikilink/embed/code-span content is exempted
// (masked before scanning) so escaping never corrupts link text.
export function escapeDescription(text: string): string {
  const masked = maskProtectedSpans(text);
  let result = '';
  let lastIndex = 0;
  for (const match of masked.matchAll(TOKEN_PATTERN)) {
    const start = match.index!;
    if (start > 0 && !/\s/.test(masked[start - 1])) continue;
    const end = start + match[0].length;
    if (end < masked.length && !/\s/.test(masked[end])) continue;
    result += text.slice(lastIndex, start) + '\\' + text.slice(start, end);
    lastIndex = end;
  }
  result += text.slice(lastIndex);
  return escapeBareDollarSigns(result);
}

// `$` gets a stricter rule than every other sigil (spec, "Escaping": "a
// task line carries at most one $ token and every literal dollar sign in
// the description is escaped" — this is what keeps Obsidian from ever
// seeing an unescaped `$…$` pair and rendering it as inline math). Unlike
// the pass above, this doesn't require the boundary that would make `$`
// tokenize on the next parse: `$5k` or `$12/month` can't tokenize either
// way (not followed by whitespace), but the spec still wants them escaped.
// A `$` already escaped by the pass above (preceded by `\`) is left alone.
function escapeBareDollarSigns(text: string): string {
  const masked = maskProtectedSpans(text);
  let result = '';
  for (let i = 0; i < text.length; i++) {
    if (masked[i] === '$' && text[i - 1] !== '\\') {
      result += '\\$';
    } else {
      result += text[i];
    }
  }
  return result;
}

export function tokenizeTaskLine(rawLine: string): TokenizeResult {
  const warnings: string[] = [];

  // 1. Extract a trailing ^blockId, if present — must be the last thing on
  //    the line (spec: "Block IDs … must be the last thing on the line").
  let line = rawLine;
  let blockId: string | undefined;
  const idMatch = line.match(BLOCK_ID_RE);
  if (idMatch) {
    blockId = idMatch[1];
    line = line.slice(0, idMatch.index);
  }

  const dueDates: string[] = [];
  const deferDates: string[] = [];
  const contexts: string[] = [];
  const efforts: Effort[] = [];
  const actuals: Actual[] = [];
  const tags: Tag[] = [];
  let value: number | undefined;
  let complexity: number | undefined;

  const textParts: string[] = [];
  let lastIndex = 0;

  for (const { start, end, match } of scanRawTokenMatches(line)) {
    const gap = line.slice(lastIndex, start).trimEnd();
    if (gap) textParts.push(gap);
    lastIndex = end;

    const [, , dateVal, deferVal, ctxVal, valStr, cmpxStr, tildeEffortStr, starEffortStr, actualStr, tagName, tagVal] =
      match;

    if (dateVal !== undefined) {
      if (DATE_RE.test(dateVal)) {
        dueDates.push(dateVal);
      } else {
        warnings.push(`Invalid due date: !${dateVal} — treating as description text`);
        textParts.push(`!${dateVal}`);
      }
    } else if (deferVal !== undefined) {
      if (DATE_RE.test(deferVal)) {
        deferDates.push(deferVal);
      } else {
        warnings.push(`Invalid defer date: >${deferVal} — treating as description text`);
        textParts.push(`>${deferVal}`);
      }
    } else if (ctxVal !== undefined) {
      if (ctxVal === 'waiting') {
        warnings.push('Deprecated @waiting context — rewritten to #waiting/unknown on save');
        tags.push({ type: 'nested', key: 'waiting', value: 'unknown' });
      } else {
        contexts.push(ctxVal);
      }
    } else if (valStr !== undefined) {
      value = parseFloat(valStr);
    } else if (cmpxStr !== undefined) {
      complexity = parseFloat(cmpxStr);
    } else if (tildeEffortStr !== undefined) {
      const effort = parseEffort(tildeEffortStr);
      if (effort) {
        efforts.push(effort);
      } else {
        warnings.push(`Invalid effort token: ~${tildeEffortStr} — treating as description text`);
        textParts.push(`~${tildeEffortStr}`);
      }
    } else if (starEffortStr !== undefined) {
      const effort = parseEffort(starEffortStr);
      if (effort) {
        efforts.push(effort);
        warnings.push(`Deprecated effort token *${starEffortStr} — rewritten to ~${starEffortStr} on save`);
      } else {
        warnings.push(`Invalid effort token: *${starEffortStr} — treating as description text`);
        textParts.push(`*${starEffortStr}`);
      }
    } else if (actualStr !== undefined) {
      const actual = parseActual(actualStr);
      if (actual) {
        actuals.push(actual);
      } else {
        warnings.push(`Invalid actual token: &${actualStr} — treating as description text`);
        textParts.push(`&${actualStr}`);
      }
    } else if (tagName !== undefined) {
      if (/^\d+$/.test(tagName)) {
        // Purely numeric — not a tag per spec (fixes v1's "#42" bug).
        textParts.push(tagVal !== undefined ? `#${tagName}(${tagVal})` : `#${tagName}`);
      } else if (tagVal !== undefined) {
        warnings.push(`Deprecated tag syntax #${tagName}(${tagVal}) — rewritten to #${tagName}/${tagVal} on save`);
        tags.push({ type: 'nested', key: tagName, value: tagVal });
      } else if (tagName.includes('/')) {
        const slash = tagName.indexOf('/');
        tags.push({ type: 'nested', key: tagName.slice(0, slash), value: tagName.slice(slash + 1) });
      } else {
        tags.push({ type: 'label', name: tagName });
      }
    }
  }

  const tail = line.slice(lastIndex).trim();
  if (tail) textParts.push(tail);

  const text = unescapeText(textParts.join(' ').trim());

  const result: TokenizeResult = { text, contexts, tags, warnings };
  if (dueDates.length > 0) result.dueDate = dueDates[dueDates.length - 1];
  if (deferDates.length > 0) result.deferDate = deferDates[deferDates.length - 1];
  if (value !== undefined) result.value = value;
  if (complexity !== undefined) result.complexity = complexity;
  if (efforts.length > 0) result.effort = efforts[efforts.length - 1];
  if (actuals.length > 0) result.actual = actuals[actuals.length - 1];
  if (blockId !== undefined) result.blockId = blockId;

  return result;
}
