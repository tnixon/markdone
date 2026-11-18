import { App } from './fakeObsidian';
import { isMarkdoneNote, noteMarkerStatus } from '../marker';

describe('the marker gate', () => {
  const app = new App({
    'notes/plain.md': '# Just a note\n\n- [ ] a checkbox\n',
    'notes/marked.md': '---\nmarkdone: 2\n---\n- [ ] task\n',
    'notes/future.md': '---\nmarkdone: 3\n---\n- [ ] task\n',
    'notes/junk.md': '---\nmarkdone: yes\n---\n- [ ] task\n',
    'workspace/home-network/todo.md': '---\nmarkdone: 2\n---\n- [ ] Router\n',
    'workspace/home-network/plan.md': '- [ ] draft\n',
  });

  test('an unmarked note is not a Markdone note', () => {
    expect(isMarkdoneNote(app as any, 'notes/plain.md')).toBe(false);
    expect(noteMarkerStatus(app as any, 'notes/plain.md')).toBe('absent');
  });

  test('a marked note is', () => {
    expect(isMarkdoneNote(app as any, 'notes/marked.md')).toBe(true);
  });

  test('a marker naming an unsupported version is not', () => {
    expect(isMarkdoneNote(app as any, 'notes/future.md')).toBe(false);
    expect(noteMarkerStatus(app as any, 'notes/future.md')).toBe('unsupported');
    expect(noteMarkerStatus(app as any, 'notes/junk.md')).toBe('unreadable');
  });

  test('a marked todo.md in a subfolder of a workspace folder is; its unmarked sibling is not', () => {
    expect(isMarkdoneNote(app as any, 'workspace/home-network/todo.md')).toBe(true);
    expect(isMarkdoneNote(app as any, 'workspace/home-network/plan.md')).toBe(false);
  });

  test('a path the vault does not know is not', () => {
    expect(isMarkdoneNote(app as any, 'nowhere.md')).toBe(false);
  });
});
