import type { FileStat, FileSystem } from '@markdone/core';

const KEY_PREFIX = 'markdone:fs:';

function storageKey(path: string): string {
  return `${KEY_PREFIX}${path.replace(/^\/+/, '').replace(/\/+$/, '')}`;
}

function pathFromStorageKey(key: string): string {
  return key.slice(KEY_PREFIX.length);
}

/**
 * `FileSystem` implementation for the browser / embed build — treats
 * `localStorage` as a flat virtual filesystem, keyed by path under a
 * `markdone:fs:` namespace so it can coexist with the app's other
 * localStorage keys (workspace registry, AI settings). Mirrors
 * `InMemoryFileSystem` (packages/core) almost exactly, just backed by real
 * `localStorage` instead of a `Map` — "directories" are implicit, and there's
 * no conflict detection (unlike `TauriFileSystem`, localStorage isn't shared
 * with an external editor or cloud sync that could race with this tab).
 */
export class LocalStorageFileSystem implements FileSystem {
  private clock = 0;
  private readonly mtimes = new Map<string, number>();

  async read(path: string): Promise<string> {
    const content = localStorage.getItem(storageKey(path));
    if (content === null) throw new Error(`File not found: ${path}`);
    return content;
  }

  async write(path: string, content: string): Promise<void> {
    localStorage.setItem(storageKey(path), content);
    this.mtimes.set(path, ++this.clock);
  }

  async list(dirPath: string): Promise<string[]> {
    const prefix = dirPath.replace(/^\/+/, '').replace(/\/+$/, '');
    const seen = new Set<string>();
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(KEY_PREFIX)) continue;
      const path = pathFromStorageKey(key);
      if (prefix !== '' && !path.startsWith(`${prefix}/`)) continue;
      const rest = prefix === '' ? path : path.slice(prefix.length + 1);
      const [child] = rest.split('/');
      if (child) seen.add(child);
    }
    return [...seen];
  }

  async stat(path: string): Promise<FileStat> {
    if (localStorage.getItem(storageKey(path)) !== null) {
      return { mtimeMs: this.mtimes.get(path) ?? 0, isDirectory: false };
    }
    const isDirectory = (await this.list(path)).length > 0;
    if (isDirectory) return { mtimeMs: 0, isDirectory: true };
    throw new Error(`Path not found: ${path}`);
  }

  async delete(path: string): Promise<void> {
    const key = storageKey(path);
    if (localStorage.getItem(key) === null) throw new Error(`File not found: ${path}`);
    localStorage.removeItem(key);
    this.mtimes.delete(path);
  }
}
