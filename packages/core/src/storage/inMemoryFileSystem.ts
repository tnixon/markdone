import type { FileStat, FileSystem } from './fileSystem';

function normalize(path: string): string {
  return path.replace(/^\/+/, '').replace(/\/+$/, '');
}

// In-memory `FileSystem`, used by this package's own tests (and available to
// any consumer that wants a filesystem without a real disk). "Directories"
// are implicit: any path that is a proper prefix of a stored file's path is
// a directory, matching a real filesystem closely enough for `list`/`stat`.
export class InMemoryFileSystem implements FileSystem {
  private files = new Map<string, string>();
  private mtimes = new Map<string, number>();
  private clock = 0;

  async read(path: string): Promise<string> {
    const key = normalize(path);
    const content = this.files.get(key);
    if (content === undefined) throw new Error(`File not found: ${path}`);
    return content;
  }

  async write(path: string, content: string): Promise<void> {
    const key = normalize(path);
    this.files.set(key, content);
    this.mtimes.set(key, ++this.clock);
  }

  async list(dirPath: string): Promise<string[]> {
    const prefix = normalize(dirPath);
    const seen = new Set<string>();
    for (const key of this.files.keys()) {
      if (prefix !== '' && !key.startsWith(`${prefix}/`)) continue;
      const rest = prefix === '' ? key : key.slice(prefix.length + 1);
      const [child] = rest.split('/');
      if (child) seen.add(child);
    }
    return [...seen];
  }

  async stat(path: string): Promise<FileStat> {
    const key = normalize(path);
    const mtimeMs = this.mtimes.get(key);
    if (mtimeMs !== undefined) return { mtimeMs, isDirectory: false };
    const isDirectory = [...this.files.keys()].some(k => k.startsWith(`${key}/`));
    if (isDirectory) return { mtimeMs: 0, isDirectory: true };
    throw new Error(`Path not found: ${path}`);
  }

  async delete(path: string): Promise<void> {
    const key = normalize(path);
    if (!this.files.delete(key)) throw new Error(`File not found: ${path}`);
    this.mtimes.delete(key);
  }
}
