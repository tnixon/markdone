import { App } from './fakeObsidian';
import { WorkspaceManager } from '../workspaces';

describe('WorkspaceManager', () => {
  test('configure loads each folder as a directory-mode workspace', async () => {
    const app = new App({
      'personal/inbox.md': '- [ ] Task A',
      'work/inbox.md': '- [ ] Task B',
    });
    const onChange = vi.fn();
    const manager = new WorkspaceManager(app as any, onChange);

    await manager.configure(['personal', 'work']);

    expect(manager.list().map(w => w.id)).toEqual(['personal', 'work']);
    expect(onChange).toHaveBeenCalled();
  });

  test('maps each project to the file it lives in, by reference', async () => {
    const app = new App({
      'workspace/inbox.md': '',
      'workspace/reading-list.md': ['---', 'markdone: 2', '---', '# Reading List', '', '- [ ] Deep Work'].join('\n'),
    });
    const manager = new WorkspaceManager(app as any, () => {});
    await manager.configure(['workspace']);

    const ws = manager.find('workspace')!;
    const readingList = ws.handle.getProject('reading-list')!;
    expect(ws.projectFiles.get(readingList)).toBe('workspace/reading-list.md');
  });

  test('a vault event outside any configured folder is ignored', async () => {
    const app = new App({ 'workspace/inbox.md': '' });
    const onChange = vi.fn();
    const manager = new WorkspaceManager(app as any, onChange);
    await manager.configure(['workspace']);
    onChange.mockClear();

    manager.handleVaultEvent('somewhere-else/note.md');
    await new Promise(resolve => setTimeout(resolve, 350));

    expect(onChange).not.toHaveBeenCalled();
  });

  test('a vault event under a configured folder triggers a debounced reload', async () => {
    const app = new App({ 'workspace/inbox.md': '- [ ] Original' });
    const onChange = vi.fn();
    const manager = new WorkspaceManager(app as any, onChange);
    await manager.configure(['workspace']);
    onChange.mockClear();

    app.vault.seedFile('workspace/inbox.md', '- [ ] Original\n- [ ] New task');
    manager.handleVaultEvent('workspace/inbox.md');

    expect(onChange).not.toHaveBeenCalled(); // debounced, not immediate
    await new Promise(resolve => setTimeout(resolve, 350));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('rapid repeated events for the same workspace reload only once', async () => {
    const app = new App({ 'workspace/inbox.md': '' });
    const onChange = vi.fn();
    const manager = new WorkspaceManager(app as any, onChange);
    await manager.configure(['workspace']);
    onChange.mockClear();

    manager.handleVaultEvent('workspace/inbox.md');
    manager.handleVaultEvent('workspace/inbox.md');
    manager.handleVaultEvent('workspace/inbox.md');
    await new Promise(resolve => setTimeout(resolve, 350));

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test('dispose cancels pending debounced reloads', async () => {
    const app = new App({ 'workspace/inbox.md': '' });
    const onChange = vi.fn();
    const manager = new WorkspaceManager(app as any, onChange);
    await manager.configure(['workspace']);
    onChange.mockClear();

    manager.handleVaultEvent('workspace/inbox.md');
    manager.dispose();
    await new Promise(resolve => setTimeout(resolve, 350));

    expect(onChange).not.toHaveBeenCalled();
  });

  describe('folders that are not in the vault', () => {
    test('are flagged missing and never created', async () => {
      const app = new App({ 'other/inbox.md': '' });
      const createFolder = vi.spyOn(app.vault, 'createFolder');
      const manager = new WorkspaceManager(app as any, () => {});

      await manager.configure(['0', '02', '02-']);

      for (const folder of ['0', '02', '02-']) expect(app.vault.has(folder)).toBe(false);
      expect(createFolder).not.toHaveBeenCalled();
      expect(manager.list()).toEqual([]);
      expect(manager.missingFolders()).toEqual(['0', '02', '02-']);
    });

    test('an existing folder without an inbox gets inbox.md and no new folder', async () => {
      const app = new App({ 'projects/notes.md': '' });
      const createFolder = vi.spyOn(app.vault, 'createFolder');
      const manager = new WorkspaceManager(app as any, () => {});

      await manager.configure(['projects']);

      expect(app.vault.has('projects/inbox.md')).toBe(true);
      expect(createFolder).not.toHaveBeenCalled();
      expect(manager.missingFolders()).toEqual([]);
    });

    test('a deleted configured folder is not re-created by the next reload', async () => {
      const app = new App({ 'workspace/inbox.md': '' });
      const manager = new WorkspaceManager(app as any, () => {});
      await manager.configure(['workspace']);

      await app.vault.trash(app.vault.getAbstractFileByPath('workspace/inbox.md')!);
      await app.vault.trash(app.vault.getFolderByPath('workspace')!);
      manager.handleVaultEvent('workspace');
      await new Promise(resolve => setTimeout(resolve, 350));

      expect(app.vault.has('workspace')).toBe(false);
      expect(manager.list()).toEqual([]);
      expect(manager.missingFolders()).toEqual(['workspace']);
    });

    test('a missing folder that appears later is initialized on its vault event', async () => {
      const app = new App();
      const manager = new WorkspaceManager(app as any, () => {});
      await manager.configure(['later']);
      expect(manager.missingFolders()).toEqual(['later']);

      await app.vault.createFolder('later');
      manager.handleVaultEvent('later');
      await new Promise(resolve => setTimeout(resolve, 350));

      expect(app.vault.has('later/inbox.md')).toBe(true);
      expect(manager.list().map(w => w.id)).toEqual(['later']);
      expect(manager.missingFolders()).toEqual([]);
    });
  });

  test('configured folders are normalized before lookup', async () => {
    const app = new App({ 'projects/inbox.md': '' });
    const manager = new WorkspaceManager(app as any, () => {});

    await manager.configure(['projects/', '/projects', './projects']);

    expect(manager.list().map(w => w.id)).toEqual(['projects', 'projects', 'projects']);
    expect(manager.missingFolders()).toEqual([]);
  });
});
