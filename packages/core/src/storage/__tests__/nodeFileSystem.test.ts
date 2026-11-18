import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { NodeFileSystem } from '../nodeFileSystem';

describe('NodeFileSystem', () => {
  let dir: string;
  let fs: NodeFileSystem;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'markdone-nodefs-'));
    fs = new NodeFileSystem();
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test('read throws for a missing file', async () => {
    await expect(fs.read(path.join(dir, 'missing.md'))).rejects.toThrow();
  });

  test('write then read round-trips content', async () => {
    const file = path.join(dir, 'a.md');
    await fs.write(file, 'hello');
    expect(await fs.read(file)).toBe('hello');
  });

  test('write creates missing parent directories', async () => {
    const file = path.join(dir, 'nested', 'deeper', 'a.md');
    await fs.write(file, 'hello');
    expect(await fs.read(file)).toBe('hello');
  });

  test('write updates existing content', async () => {
    const file = path.join(dir, 'a.md');
    await fs.write(file, 'hello');
    await fs.write(file, 'world');
    expect(await fs.read(file)).toBe('world');
  });

  test('list returns immediate children as bare names', async () => {
    await fs.write(path.join(dir, 'a.md'), '1');
    await fs.write(path.join(dir, 'b.md'), '2');
    await fs.write(path.join(dir, 'nested', 'c.md'), '3');

    const children = await fs.list(dir);
    expect(new Set(children)).toEqual(new Set(['a.md', 'b.md', 'nested']));
  });

  test('list returns an empty array for a directory that does not exist', async () => {
    const children = await fs.list(path.join(dir, 'nope'));
    expect(children).toEqual([]);
  });

  test('stat reports mtimeMs for a file and isDirectory: false', async () => {
    const file = path.join(dir, 'a.md');
    await fs.write(file, '1');
    const stat = await fs.stat(file);
    expect(stat.isDirectory).toBe(false);
    expect(typeof stat.mtimeMs).toBe('number');
  });

  test('stat reports isDirectory: true for a directory', async () => {
    const stat = await fs.stat(dir);
    expect(stat.isDirectory).toBe(true);
  });

  test('stat throws for a path that does not exist', async () => {
    await expect(fs.stat(path.join(dir, 'nope'))).rejects.toThrow();
  });

  test('delete removes a file', async () => {
    const file = path.join(dir, 'a.md');
    await fs.write(file, '1');
    await fs.delete(file);
    await expect(fs.read(file)).rejects.toThrow();
  });

  test('delete throws for a missing file', async () => {
    await expect(fs.delete(path.join(dir, 'missing.md'))).rejects.toThrow();
  });

  test('watch fires a callback when a watched file changes, and unsubscribes on the returned function', async () => {
    const file = path.join(dir, 'a.md');
    await fs.write(file, '1');

    const changes: string[] = [];
    const unsubscribe = fs.watch(file, changedPath => changes.push(changedPath));

    await fs.write(file, '2');
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(changes.length).toBeGreaterThan(0);

    unsubscribe();
    changes.length = 0;
    await fs.write(file, '3');
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(changes.length).toBe(0);
  });
});
