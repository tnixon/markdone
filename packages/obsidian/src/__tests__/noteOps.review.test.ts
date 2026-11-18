import * as fs from 'node:fs';
import * as path from 'node:path';
import { planNoteOperation } from '../noteOps';

const CORPUS = path.resolve(__dirname, '../../../../spec/corpus');
function fixture(name: string): string {
  const text = fs.readFileSync(path.join(CORPUS, name), 'utf8');
  const lines = text.split('\n');
  return lines.slice(lines.findIndex(l => l.trim() === '-->') + 1).join('\n');
}
const changedLines = (a: string, b: string) => {
  const x = a.split('\n');
  const y = b.split('\n');
  return Math.max(x.length, y.length) - [...x].filter((l, i) => l === y[i]).length;
};

describe('a click rewrites only the targeted task', () => {
  test('a note full of prose, a callout, a code fence and blank lines is otherwise byte-identical', () => {
    const note = fixture('obsidian-note.md');
    const lines = note.split('\n');
    const line = lines.findIndex(l => /^- \[ \] /.test(l));
    expect(line).toBeGreaterThan(-1);

    // on-complete: none, so the task completes in place and nothing else moves.
    const withNone = note.replace('markdone: 2\n', 'markdone: 2\non-complete: none\n');
    const l2 = withNone.split('\n').findIndex(l => /^- \[ \] /.test(l));
    const plan = planNoteOperation(withNone, { line: l2, expectedLine: withNone.split('\n')[l2], intent: { kind: 'complete' } }, 'n');
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(changedLines(withNone, plan.after)).toBe(1);
    expect(plan.after.split('\n')).toHaveLength(withNone.split('\n').length);
  });

  test('a move changes the moved task and nothing else', () => {
    const note = '---\nmarkdone: 2\nlayout: kanban\ncolumns: [Next, Done]\n---\n\n## Next\n\n- [ ] A ^a1\n\n```\n## not a column\n```\n\n## Done\n\n> [!note] keep\n';
    const line = note.split('\n').findIndex(l => l.startsWith('- [ ] A'));
    const plan = planNoteOperation(note, { line, expectedLine: note.split('\n')[line], intent: { kind: 'complete' } }, 'n');
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.after).toContain('```\n## not a column\n```');
    expect(plan.after).toContain('> [!note] keep');
    expect(plan.after.startsWith('---\nmarkdone: 2\nlayout: kanban\ncolumns: [Next, Done]\n---\n')).toBe(true);
  });
});

describe('inherited workspace defaults are never written into the note', () => {
  test('a note that declares only the marker keeps its frontmatter byte for byte', () => {
    const note = '---\nmarkdone: 2\n---\n\n## Next\n\n- [ ] A ^a1\n\n## Done\n';
    const line = note.split('\n').findIndex(l => l.startsWith('- [ ] A'));
    const plan = planNoteOperation(
      note,
      { line, expectedLine: note.split('\n')[line], intent: { kind: 'complete' } },
      'n',
      { layout: 'kanban', columns: ['Next', 'Done'], owner: 'alice', priority: 2, onComplete: 'Done' },
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.after.startsWith('---\nmarkdone: 2\n---\n')).toBe(true);
    expect(plan.after).not.toMatch(/owner:|priority:|columns:|layout:|on-complete:/);
    expect(plan.after).toContain('## Done\n- [x] A');
  });
});

describe('line endings', () => {
  test('a CRLF note stays CRLF throughout', () => {
    const note = ['---', 'markdone: 2', 'layout: kanban', 'columns: [Next, Done]', '---', '', '## Next', '', '- [ ] A ^a1', '- [ ] B ^b1', '', '## Done', ''].join('\r\n');
    const line = note.split('\n').findIndex(l => l.startsWith('- [ ] A'));
    const plan = planNoteOperation(note, { line, expectedLine: note.split('\n')[line], intent: { kind: 'complete' } }, 'n');
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.after.replace(/\r\n/g, '')).not.toContain('\n');
    expect(plan.after).toContain('- [x] A');
  });
});

describe('subtasks under on-complete', () => {
  test('completing a subtask by click leaves its parent in its column', () => {
    const note = '---\nmarkdone: 2\nlayout: kanban\ncolumns: [Next, Done]\n---\n\n## Next\n\n- [ ] Parent ^p1\n  - [ ] Child ^c1\n\n## Done\n';
    const line = note.split('\n').findIndex(l => l.includes('Child'));
    const plan = planNoteOperation(note, { line, expectedLine: note.split('\n')[line], intent: { kind: 'complete' } }, 'n');
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.after).toContain('## Next\n\n- [ ] Parent ^p1\n  - [x] Child');
  });
});
