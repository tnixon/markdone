import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse, serialize } from '@markdone/core';

// Every task-line example quoted in the skill's own docs must actually be
// valid, canonical spec v2 — an agent reading these docs takes them as
// ground truth, so a stale or non-canonical example would teach the wrong
// thing silently. This walks every in-scope doc, pulls out anything that
// looks like a real task line (a checkbox followed by real content, not a
// bare `- [ ]` notation example), and round-trips it through the real
// parser/serializer.
const TASK_LINE_PATTERN = /^- \[[ xX-]\] \S.*$/;

// In scope: the skill body and its hand-authored reference docs, plus this
// package's own README. Out of scope:
// - markdone/reference/operations.md — generated, covered by
//   reference.test.ts instead.
// - markdone/reference/TODO_FORMAT.md — a byte-for-byte vendored copy of
//   spec/TODO_FORMAT.md (see reference.test.ts), which deliberately shows
//   deprecated/invalid syntax as counter-examples; the conformance corpus
//   already exercises it in its own right.
const SCOPED_FILES = [
  'markdone/SKILL.md',
  'markdone/reference/tokens.md',
  'markdone/reference/interfaces.md',
  'markdone/reference/workflow-summary.md',
  'markdone/reference/workflow-lint.md',
  'README.md',
];

function extractCandidateLines(markdown: string): string[] {
  const lines: string[] = [];

  // Fenced code blocks: every line inside, checked individually.
  for (const block of markdown.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) {
    lines.push(...block[1].split('\n'));
  }

  // Inline code spans: the whole span content, when it looks like one line.
  for (const span of markdown.matchAll(/`([^`\n]+)`/g)) {
    lines.push(span[1]);
  }

  return lines.filter(line => TASK_LINE_PATTERN.test(line.trim())).map(line => line.trim());
}

describe('task-line examples in the skill docs parse as canonical spec v2', () => {
  const packageRoot = path.resolve(__dirname, '../..');
  const allExamples: { file: string; line: string }[] = [];

  for (const relPath of SCOPED_FILES) {
    const text = readFileSync(path.join(packageRoot, relPath), 'utf8');
    for (const line of extractCandidateLines(text)) {
      allExamples.push({ file: relPath, line });
    }
  }

  test('the extractor found at least one example (guards against a silently broken pattern)', () => {
    expect(allExamples.length).toBeGreaterThan(0);
  });

  for (const { file, line } of allExamples) {
    test(`${file}: \`${line}\``, () => {
      const wrapped = `# Inbox\n\n${line}`;
      const { file: parsed, warnings } = parse(wrapped);

      // No warnings: not deprecated syntax, not malformed, nothing that
      // would trigger the parser's graceful-degradation path.
      expect(warnings).toEqual([]);

      // Byte-identical round-trip: canonical token order already, no
      // normalization needed (a normalizing round-trip wouldn't throw,
      // but it would mean the doc is showing non-canonical order).
      expect(serialize(parsed)).toBe(wrapped);
    });
  }
});
