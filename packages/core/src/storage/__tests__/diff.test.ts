import { formatDiff } from '../diff';

describe('formatDiff', () => {
  test('a new file (before null) shows every line added against /dev/null', () => {
    const out = formatDiff('inbox.md', null, 'line one\nline two');
    expect(out).toBe(['--- /dev/null', '+++ inbox.md', '+line one', '+line two'].join('\n'));
  });

  test('a deleted file (after null) shows every line removed against /dev/null', () => {
    const out = formatDiff('inbox.md', 'line one\nline two', null);
    expect(out).toBe(['--- inbox.md', '+++ /dev/null', '-line one', '-line two'].join('\n'));
  });

  test('a modified file shows unchanged lines, removals, and additions', () => {
    const out = formatDiff('inbox.md', 'a\nb\nc', 'a\nx\nc');
    expect(out).toBe(['--- inbox.md', '+++ inbox.md', ' a', '-b', '+x', ' c'].join('\n'));
  });

  test('an unchanged file has no +/- lines', () => {
    const out = formatDiff('inbox.md', 'same\ntext', 'same\ntext');
    expect(out).toBe(['--- inbox.md', '+++ inbox.md', ' same', ' text'].join('\n'));
  });
});
