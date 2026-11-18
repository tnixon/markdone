import type { Editor } from 'obsidian';
import { insertBlockIdOnCurrentLine } from './insertBlockId';

function fakeEditor(lines: string[], cursorLine: number): Editor & { lines: string[] } {
  return {
    lines,
    getCursor: () => ({ line: cursorLine, ch: 0 }),
    getLine: (n: number) => lines[n],
    setLine: (n: number, text: string) => {
      lines[n] = text;
    },
  } as unknown as Editor & { lines: string[] };
}

describe('insertBlockIdOnCurrentLine', () => {
  test('appends an id to a task line with none, changing nothing else on the line', () => {
    const editor = fakeEditor(['- [ ] Buy milk @errands'], 0);
    const result = insertBlockIdOnCurrentLine(editor);
    expect(result).toBe('inserted');
    expect(editor.lines[0]).toMatch(/^- \[ \] Buy milk @errands \^[A-Za-z0-9-]+$/);
  });

  test('is a no-op when the task already has an id', () => {
    const editor = fakeEditor(['- [ ] Buy milk ^existing-id'], 0);
    const result = insertBlockIdOnCurrentLine(editor);
    expect(result).toBe('already-has-id');
    expect(editor.lines[0]).toBe('- [ ] Buy milk ^existing-id');
  });

  test('is a no-op on a non-task line', () => {
    const editor = fakeEditor(['Just a paragraph'], 0);
    const result = insertBlockIdOnCurrentLine(editor);
    expect(result).toBe('not-a-task');
    expect(editor.lines[0]).toBe('Just a paragraph');
  });

  test('operates on the cursor\'s line, not always line 0', () => {
    const editor = fakeEditor(['# Heading', '- [ ] Task one', '- [ ] Task two'], 2);
    insertBlockIdOnCurrentLine(editor);
    expect(editor.lines[1]).toBe('- [ ] Task one');
    expect(editor.lines[2]).toMatch(/^- \[ \] Task two \^/);
  });

  test('generated ids are unique across calls', () => {
    const editor1 = fakeEditor(['- [ ] Task'], 0);
    const editor2 = fakeEditor(['- [ ] Task'], 0);
    insertBlockIdOnCurrentLine(editor1);
    insertBlockIdOnCurrentLine(editor2);
    const id1 = editor1.lines[0].split('^')[1];
    const id2 = editor2.lines[0].split('^')[1];
    expect(id1).not.toBe(id2);
  });
});
