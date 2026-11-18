import { InMemoryFileSystem } from '../inMemoryFileSystem';

describe('InMemoryFileSystem', () => {
  let fs: InMemoryFileSystem;

  beforeEach(() => {
    fs = new InMemoryFileSystem();
  });

  test('read throws for a missing file', async () => {
    await expect(fs.read('missing.md')).rejects.toThrow();
  });

  test('write then read round-trips content', async () => {
    await fs.write('a.md', 'hello');
    expect(await fs.read('a.md')).toBe('hello');
  });

  test('write updates existing content', async () => {
    await fs.write('a.md', 'hello');
    await fs.write('a.md', 'world');
    expect(await fs.read('a.md')).toBe('world');
  });

  test('list returns immediate children of a directory', async () => {
    await fs.write('dir/a.md', '1');
    await fs.write('dir/b.md', '2');
    await fs.write('dir/nested/c.md', '3');
    await fs.write('other.md', '4');

    const children = await fs.list('dir');
    expect(new Set(children)).toEqual(new Set(['a.md', 'b.md', 'nested']));
  });

  test('list at root returns top-level entries', async () => {
    await fs.write('a.md', '1');
    await fs.write('dir/b.md', '2');

    const children = await fs.list('');
    expect(new Set(children)).toEqual(new Set(['a.md', 'dir']));
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
    const stat = await fs.stat('dir');
    expect(stat.isDirectory).toBe(true);
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
