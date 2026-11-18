import { App } from './fakeObsidian';
import { VaultFileSystem } from '../vaultFileSystem';

describe('VaultFileSystem', () => {
  test('read returns a seeded file\'s content', async () => {
    const app = new App({ 'workspace/inbox.md': '- [ ] Buy milk' });
    const fs = new VaultFileSystem(app as any);
    expect(await fs.read('workspace/inbox.md')).toBe('- [ ] Buy milk');
  });

  test('read throws for a missing file — WorkspaceHandle relies on this', async () => {
    const app = new App();
    const fs = new VaultFileSystem(app as any);
    await expect(fs.read('nope.md')).rejects.toThrow();
  });

  test('write overwrites an existing file via vault.process', async () => {
    const app = new App({ 'todo.md': 'old' });
    const fs = new VaultFileSystem(app as any);
    await fs.write('todo.md', 'new');
    expect(app.vault.fileContent('todo.md')).toBe('new');
  });

  test('write creates a new file, and its missing parent folders, when none exists', async () => {
    const app = new App();
    const fs = new VaultFileSystem(app as any);
    await fs.write('workspace/project.md', 'content');
    expect(app.vault.fileContent('workspace/project.md')).toBe('content');
    expect(app.vault.getFolderByPath('workspace')).not.toBeNull();
  });

  test('list returns bare child names, not full paths', async () => {
    const app = new App({ 'workspace/inbox.md': '', 'workspace/project.md': '' });
    const fs = new VaultFileSystem(app as any);
    const names = await fs.list('workspace');
    expect(names.sort()).toEqual(['inbox.md', 'project.md']);
  });

  test('list returns an empty array for a folder that does not exist, not an error', async () => {
    const app = new App();
    const fs = new VaultFileSystem(app as any);
    expect(await fs.list('nonexistent')).toEqual([]);
  });

  test('stat reports mtime and isDirectory for a file', async () => {
    const app = new App({ 'todo.md': 'x' });
    const fs = new VaultFileSystem(app as any);
    const stat = await fs.stat('todo.md');
    expect(stat.isDirectory).toBe(false);
    expect(stat.mtimeMs).toBeGreaterThan(0);
  });

  test('stat reports isDirectory for a folder', async () => {
    const app = new App({ 'workspace/inbox.md': '' });
    const fs = new VaultFileSystem(app as any);
    const stat = await fs.stat('workspace');
    expect(stat.isDirectory).toBe(true);
  });

  test('stat throws for a path that does not exist — the "file absent" signal WorkspaceHandle conflict-detection depends on', async () => {
    const app = new App();
    const fs = new VaultFileSystem(app as any);
    await expect(fs.stat('nope.md')).rejects.toThrow();
  });

  test('a write followed by a read observes the new content (re-read before mutate)', async () => {
    const app = new App({ 'todo.md': 'first' });
    const fs = new VaultFileSystem(app as any);
    await fs.write('todo.md', 'second');
    expect(await fs.read('todo.md')).toBe('second');
  });

  test('delete routes through FileManager.trashFile, not a hard unlink', async () => {
    const app = new App({ 'todo.md': 'x' });
    const trashSpy = vi.spyOn(app.fileManager, 'trashFile');
    const fs = new VaultFileSystem(app as any);
    await fs.delete('todo.md');
    expect(trashSpy).toHaveBeenCalledTimes(1);
    expect(app.vault.has('todo.md')).toBe(false);
  });

  test('delete throws for a path that does not exist', async () => {
    const app = new App();
    const fs = new VaultFileSystem(app as any);
    await expect(fs.delete('nope.md')).rejects.toThrow();
  });
});
