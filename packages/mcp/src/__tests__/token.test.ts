import { computeToken } from '../token';

const CHANGES = [{ path: 'inbox.md', before: 'old content', after: 'new content' }];

describe('computeToken', () => {
  test('is deterministic for the same inputs', () => {
    const a = computeToken('ws-1', 'addTask', { text: 'Buy milk' }, CHANGES);
    const b = computeToken('ws-1', 'addTask', { text: 'Buy milk' }, CHANGES);
    expect(a).toBe(b);
  });

  test('differs when the workspace id differs', () => {
    const a = computeToken('ws-1', 'addTask', {}, CHANGES);
    const b = computeToken('ws-2', 'addTask', {}, CHANGES);
    expect(a).not.toBe(b);
  });

  test('differs when the operation name differs', () => {
    const a = computeToken('ws-1', 'addTask', {}, CHANGES);
    const b = computeToken('ws-1', 'deleteTask', {}, CHANGES);
    expect(a).not.toBe(b);
  });

  test('differs when the input differs', () => {
    const a = computeToken('ws-1', 'addTask', { text: 'Buy milk' }, CHANGES);
    const b = computeToken('ws-1', 'addTask', { text: 'Buy eggs' }, CHANGES);
    expect(a).not.toBe(b);
  });

  test('is independent of input key order', () => {
    const a = computeToken('ws-1', 'addTask', { text: 'x', value: 3 }, CHANGES);
    const b = computeToken('ws-1', 'addTask', { value: 3, text: 'x' }, CHANGES);
    expect(a).toBe(b);
  });

  test('differs when a change\'s before-content differs, which is the whole point: a concurrent edit must change the token', () => {
    const a = computeToken('ws-1', 'addTask', {}, [{ path: 'inbox.md', before: 'original', after: 'x' }]);
    const b = computeToken('ws-1', 'addTask', {}, [{ path: 'inbox.md', before: 'edited by someone else', after: 'x' }]);
    expect(a).not.toBe(b);
  });

  test('is independent of change array order', () => {
    const twoChanges = [
      { path: 'a.md', before: 'a', after: 'a2' },
      { path: 'b.md', before: 'b', after: 'b2' },
    ];
    const a = computeToken('ws-1', 'applyBatch', {}, twoChanges);
    const b = computeToken('ws-1', 'applyBatch', {}, [...twoChanges].reverse());
    expect(a).toBe(b);
  });

  test('distinguishes a null before (file created) from an empty-string before', () => {
    const created = computeToken('ws-1', 'addTask', {}, [{ path: 'x.md', before: null, after: 'y' }]);
    const emptyFile = computeToken('ws-1', 'addTask', {}, [{ path: 'x.md', before: '', after: 'y' }]);
    expect(created).not.toBe(emptyFile);
  });
});
