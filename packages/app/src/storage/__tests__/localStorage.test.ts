import { LocalStorageFileSystem } from '../localStorage';

describe('LocalStorageFileSystem', () => {
  let fs: LocalStorageFileSystem;

  beforeEach(() => {
    localStorage.clear();
    fs = new LocalStorageFileSystem();
  });

  test('read throws for a missing file', async () => {
    await expect(fs.read('missing.md')).rejects.toThrow();
  });

  test('write then read round-trips content', async () => {
    const markdown = '# Inbox\n\n- [ ] Buy milk\n';
    await fs.write('ws-1.md', markdown);
    expect(await fs.read('ws-1.md')).toBe(markdown);
  });

  test('multiple files stored independently', async () => {
    await fs.write('ws-1.md', '# Project A\n');
    await fs.write('ws-2.md', '# Project B\n');
    expect(await fs.read('ws-1.md')).toBe('# Project A\n');
    expect(await fs.read('ws-2.md')).toBe('# Project B\n');
  });

  test('write updates existing content', async () => {
    await fs.write('ws-1.md', 'old');
    await fs.write('ws-1.md', 'new');
    expect(await fs.read('ws-1.md')).toBe('new');
  });

  test('list returns immediate children of a directory', async () => {
    await fs.write('dir/a.md', '1');
    await fs.write('dir/b.md', '2');
    await fs.write('dir/nested/c.md', '3');
    await fs.write('other.md', '4');

    expect(new Set(await fs.list('dir'))).toEqual(new Set(['a.md', 'b.md', 'nested']));
  });

  test('list at root returns top-level entries', async () => {
    await fs.write('a.md', '1');
    await fs.write('dir/b.md', '2');
    expect(new Set(await fs.list(''))).toEqual(new Set(['a.md', 'dir']));
  });

  test('does not collide with other localStorage keys', async () => {
    localStorage.setItem('markdone:workspace-configs', '[]');
    await fs.write('workspace-configs', 'not the registry');
    expect(localStorage.getItem('markdone:workspace-configs')).toBe('[]');
    expect(await fs.read('workspace-configs')).toBe('not the registry');
  });

  test('stat reports mtimeMs for a file, bumped on each write', async () => {
    await fs.write('a.md', '1');
    const first = await fs.stat('a.md');
    expect(first.isDirectory).toBe(false);

    await fs.write('a.md', '2');
    const second = await fs.stat('a.md');
    expect(second.mtimeMs).toBeGreaterThan(first.mtimeMs);
  });

  test('stat reports isDirectory for an implicit directory', async () => {
    await fs.write('dir/a.md', '1');
    expect((await fs.stat('dir')).isDirectory).toBe(true);
  });

  test('stat throws for a path that does not exist', async () => {
    await expect(fs.stat('nope')).rejects.toThrow();
  });

  test('delete removes a file', async () => {
    await fs.write('a.md', '1');
    await fs.delete('a.md');
    await expect(fs.read('a.md')).rejects.toThrow();
  });

  test('delete throws for a missing file', async () => {
    await expect(fs.delete('missing.md')).rejects.toThrow();
  });
});
