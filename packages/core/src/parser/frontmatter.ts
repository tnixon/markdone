// YAML frontmatter parsing and (surgical) serialization.
//
// `raw` is the exact source text between the `---` delimiters and is what
// gets re-emitted verbatim whenever nothing recognized has changed — this,
// rather than a hand-rolled diff, is what keeps comments/quoting/key-order
// intact for an untouched file (spec: "Writing Frontmatter"). Only
// `updateFrontmatterKey` ever rewrites `raw`, using the `yaml` package's
// `Document` API (which targets a single key's node in place) rather than a
// full parse-then-restringify, so unrelated parts of the block survive a
// single-key edit.

import { parse as parseYaml, parseDocument, stringify as stringifyYaml } from 'yaml';
import type { Frontmatter } from '../model/types';

const RECOGNIZED_KEYS = [
  'title',
  'status',
  'area',
  'goal',
  'owner',
  'due',
  'type',
  'priority',
  'review',
  'layout',
  'columns',
  'on-complete',
  // The file marker (spec: "The Markdone Marker")
  'markdone',
  // _markdone.md workspace-defaults keys
  'projects',
] as const;

// Spec major versions this implementation reads and writes.
export const SUPPORTED_MARKER_VERSIONS: readonly number[] = [2];
// The version written into newly created files.
export const CURRENT_MARKER_VERSION = 2;

export type MarkerStatus = 'absent' | 'supported' | 'unsupported' | 'unreadable';

// Classifies a frontmatter `markdone:` value. `unsupported` is a well-formed
// major version this implementation doesn't know; `unreadable` is anything
// that isn't a positive integer. Both must be reported, never loaded.
export function classifyMarker(value: unknown): MarkerStatus {
  if (value === undefined || value === null) return 'absent';
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) return 'unreadable';
  return SUPPORTED_MARKER_VERSIONS.includes(value) ? 'supported' : 'unsupported';
}

function isRecognizedKey(key: string): boolean {
  return (RECOGNIZED_KEYS as readonly string[]).includes(key);
}

export interface FrontmatterParseResult {
  frontmatter: Frontmatter;
  // Lines consumed from the start of the input, including both `---`
  // delimiter lines. 0 if no frontmatter block was found.
  consumedLines: number;
  warning?: string;
}

const EMPTY: Frontmatter = { raw: '', recognized: {}, unknown: {}, present: false };

export function parseFrontmatter(markdown: string): FrontmatterParseResult {
  const lines = markdown.split('\n');
  if (lines[0] !== '---') {
    return { frontmatter: EMPTY, consumedLines: 0 };
  }
  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      endIndex = i;
      break;
    }
  }
  if (endIndex === -1) {
    // Unterminated delimiter: not a real frontmatter block. Graceful
    // degradation — treat as absent rather than consuming the whole file.
    return { frontmatter: EMPTY, consumedLines: 0 };
  }

  const raw = lines.slice(1, endIndex).join('\n');
  let parsed: unknown;
  try {
    parsed = parseYaml(raw) ?? {};
  } catch {
    return {
      frontmatter: EMPTY,
      consumedLines: 0,
      warning: 'Malformed YAML frontmatter — treating as absent',
    };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      frontmatter: EMPTY,
      consumedLines: 0,
      warning: 'Frontmatter did not parse to a mapping — treating as absent',
    };
  }

  const recognized: Record<string, unknown> = {};
  const unknown: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (isRecognizedKey(key)) recognized[key] = value;
    else unknown[key] = value;
  }

  return {
    frontmatter: { raw, recognized, unknown, present: true },
    consumedLines: endIndex + 1,
  };
}

export function serializeFrontmatter(fm: Frontmatter): string {
  if (fm.present) {
    return `---\n${fm.raw}\n---\n`;
  }
  const combined = { ...fm.recognized, ...fm.unknown };
  if (Object.keys(combined).length === 0) return '';
  return `---\n${stringifyYaml(combined).trimEnd()}\n---\n`;
}

// Surgical single-key edit. Rewrites only that key's representation in
// `raw` (via yaml's Document API), leaving comments, ordering, and quoting
// of everything else untouched. Adds the key at the end of the block if it
// was absent.
export function updateFrontmatterKey(fm: Frontmatter, key: string, value: unknown): Frontmatter {
  const recognized = { ...fm.recognized };
  const unknown = { ...fm.unknown };
  if (isRecognizedKey(key)) recognized[key] = value;
  else unknown[key] = value;

  if (!fm.present) {
    const raw = stringifyYaml({ ...recognized, ...unknown }).trimEnd();
    return { raw, recognized, unknown, present: true };
  }

  const doc = parseDocument(fm.raw);
  doc.set(key, value);
  const raw = doc.toString().replace(/\n$/, '');
  return { raw, recognized, unknown, present: true };
}

// The text of `content` with the marker added (spec: "The Markdone Marker").
// Prepends one line to an existing frontmatter block, or creates a block; the
// rest of the file is untouched byte for byte, and the file's own line ending
// (LF or CRLF) is used for what is inserted. Used by lint fixes and by
// anything that needs to mark an existing note.
//
// Returns the content UNCHANGED when it cannot add the marker safely: a file
// that opens with a `---` fence the parser could not read as frontmatter
// (malformed YAML, or CRLF line endings the frontmatter parser doesn't
// recognize) would otherwise gain a second, conflicting block.
export function addMarkerToContent(content: string): string {
  const markerLine = `markdone: ${CURRENT_MARKER_VERSION}`;
  const eol = content.includes('\r\n') ? '\r\n' : '\n';
  const { frontmatter, consumedLines } = parseFrontmatter(content);

  if (!frontmatter.present) {
    const firstLine = content.split('\n', 1)[0].replace(/\r$/, '');
    if (firstLine === '---') return content;
    return `---${eol}${markerLine}${eol}---${eol}${content}`;
  }
  // A file whose frontmatter parsed is LF-delimited (the fence test above is
  // exact), so the rewritten block joins on '\n'.
  const lines = content.split('\n');
  const rawLines = frontmatter.raw === '' ? [] : frontmatter.raw.split('\n');
  return ['---', markerLine, ...rawLines, '---', ...lines.slice(consumedLines)].join('\n');
}
