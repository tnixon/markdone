import { App } from './fakeObsidian';
import { DirectoryWorkspaceHandle, getOperation } from '@markdone/core';
import { VaultFileSystem } from '../vaultFileSystem';
import { changedLineSpan, writePreviewedChanges, previewAndApply, MAX_REASONABLE_CHANGED_LINES } from '../write';

describe('changedLineSpan', () => {
  test('is 1 for a single line changed in the middle of an otherwise identical file', () => {
    const before = ['a', 'b', 'c', 'd'].join('\n');
    const after = ['a', 'B', 'c', 'd'].join('\n');
    expect(changedLineSpan(before, after)).toBe(1);
  });

  test('is 0 for identical text', () => {
    expect(changedLineSpan('a\nb', 'a\nb')).toBe(0);
  });

  test('is large when unrelated lines move — the rebuildBlocks regression signature', () => {
    // Everything after line 1 got hoisted above it, mirroring the plan's
    // documented repro: nothing about the CONTENT changed, only position.
    const before = ['header', 'task1', 'task2', 'prose'].join('\n');
    const after = ['task1', 'task2', 'header', 'prose'].join('\n');
    expect(changedLineSpan(before, after)).toBeGreaterThan(1);
  });

  test('handles an insertion (after is longer than before)', () => {
    const before = ['a', 'b'].join('\n');
    const after = ['a', 'new', 'b'].join('\n');
    expect(changedLineSpan(before, after)).toBe(1);
  });
});

describe('writePreviewedChanges', () => {
  test('applies a modify change and reports it', async () => {
    const app = new App({ 'todo.md': 'old content' });
    const outcomes = await writePreviewedChanges(app as any, [{ path: 'todo.md', before: 'old content', after: 'new content' }]);
    expect(outcomes).toEqual([{ path: 'todo.md', applied: true }]);
    expect(app.vault.fileContent('todo.md')).toBe('new content');
  });

  test('refuses a modify change whose span exceeds the reasonable-size guard, writing nothing', async () => {
    const before = Array.from({ length: 30 }, (_, i) => `line-${i}`).join('\n');
    const after = Array.from({ length: 30 }, (_, i) => `line-${29 - i}`).join('\n'); // fully reversed
    const app = new App({ 'todo.md': before });

    const outcomes = await writePreviewedChanges(app as any, [{ path: 'todo.md', before, after }]);
    expect(outcomes).toEqual([expect.objectContaining({ path: 'todo.md', applied: false })]);
    expect(outcomes[0].reason).toContain('refusing to write');
    expect(app.vault.fileContent('todo.md')).toBe(before); // unwritten
  });

  test('allows a modify change right at the size guard boundary', async () => {
    const app = new App();
    const lines = Array.from({ length: MAX_REASONABLE_CHANGED_LINES }, (_, i) => `line-${i}`);
    const before = lines.join('\n');
    const after = lines.map(l => `${l}-changed`).join('\n');
    await app.vault.create('todo.md', before);

    const outcomes = await writePreviewedChanges(app as any, [{ path: 'todo.md', before, after }]);
    expect(outcomes).toEqual([{ path: 'todo.md', applied: true }]);
  });

  test('a concurrent edit (live content no longer matches "before") is refused, not overwritten', async () => {
    const app = new App({ 'todo.md': 'changed-elsewhere' });
    const outcomes = await writePreviewedChanges(app as any, [
      { path: 'todo.md', before: 'stale-before', after: 'what-the-preview-computed' },
    ]);
    expect(outcomes).toEqual([expect.objectContaining({ applied: false })]);
    expect(outcomes[0].reason).toContain('modified since the preview');
    expect(app.vault.fileContent('todo.md')).toBe('changed-elsewhere'); // untouched
  });

  test('creates a new file (before: null) including any missing parent folder', async () => {
    const app = new App();
    const outcomes = await writePreviewedChanges(app as any, [{ path: 'workspace/new-project.md', before: null, after: '# New' }]);
    expect(outcomes).toEqual([{ path: 'workspace/new-project.md', applied: true }]);
    expect(app.vault.fileContent('workspace/new-project.md')).toBe('# New');
  });

  test('deletes a file (after: null) via FileManager.trashFile, not a hard unlink', async () => {
    const app = new App({ 'gone.md': 'x' });
    const trashSpy = vi.spyOn(app.fileManager, 'trashFile');
    const outcomes = await writePreviewedChanges(app as any, [{ path: 'gone.md', before: 'x', after: null }]);
    expect(outcomes).toEqual([{ path: 'gone.md', applied: true }]);
    expect(trashSpy).toHaveBeenCalledTimes(1);
    expect(app.vault.has('gone.md')).toBe(false);
  });

  test('stops at the first refused change, leaving later changes in the list unapplied', async () => {
    const app = new App({ 'a.md': 'a-content', 'b.md': 'b-content' });
    const outcomes = await writePreviewedChanges(app as any, [
      { path: 'a.md', before: 'wrong-expected-content', after: 'new-a' },
      { path: 'b.md', before: 'b-content', after: 'new-b' },
    ]);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].applied).toBe(false);
    expect(app.vault.fileContent('a.md')).toBe('a-content');
    expect(app.vault.fileContent('b.md')).toBe('b-content'); // never reached
  });
});

describe('previewAndApply', () => {
  test('previews through core, writes through Obsidian, and reloads the handle', async () => {
    const app = new App({
      'workspace/reading-list.md': ['---', 'markdone: 2', '---', '# Reading List', '', '- [ ] Deep Work ~6hrs'].join('\n'),
    });
    const handle = new DirectoryWorkspaceHandle('ws', 'workspace', new VaultFileSystem(app as any));
    await handle.reload();

    const completeTask = getOperation('completeTask')!;
    const result = await previewAndApply(app as any, handle, completeTask, {
      location: { workspaceId: 'ws', projectIndex: 1, taskIndex: 0 },
    });

    expect(result).toEqual({ ok: true });
    expect(app.vault.fileContent('workspace/reading-list.md')).toContain('- [x] Deep Work');
  });

  test('a core-level failure (e.g. task not found) is surfaced without touching any file', async () => {
    const app = new App({ 'workspace/reading-list.md': ['---', 'markdone: 2', '---', '# Reading List', ''].join('\n') });
    const handle = new DirectoryWorkspaceHandle('ws', 'workspace', new VaultFileSystem(app as any));
    await handle.reload();

    const completeTask = getOperation('completeTask')!;
    const result = await previewAndApply(app as any, handle, completeTask, {
      location: { workspaceId: 'ws', projectIndex: 1, taskIndex: 0 },
    });

    expect(result.ok).toBe(false);
  });
});
