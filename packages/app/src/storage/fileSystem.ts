import type { FileStat, FileSystem } from '@markdone/core';
import { ExternalChangeError } from '@markdone/core';

/**
 * `FileSystem` implementation for the Tauri desktop app — paths resolve to
 * real files on disk via @tauri-apps/plugin-fs.
 *
 * Path resolution: `~/...` expands against the home directory, `/...` is
 * used verbatim, and anything else is anchored to the user's Documents
 * directory. A path-traversal guard rejects `..` segments that would escape
 * the resolved root.
 *
 * Conflict detection: this instance remembers the last-known mtime for every
 * path it has read or written. `write()` re-checks that mtime immediately
 * before writing and throws `ExternalChangeError` if the file changed since —
 * e.g. from cloud sync or a text editor — so the caller can reload and notify
 * the user instead of silently clobbering the external edit. A path this
 * instance has never seen skips the check (nothing to compare against).
 *
 * `watch()` suppresses events caused by this instance's own writes (closing
 * the TOCTOU race between the write and the post-write stat that refreshes
 * the remembered mtime).
 */
export class TauriFileSystem implements FileSystem {
  private readonly lastModified = new Map<string, number>();
  private readonly writingInFlight = new Set<string>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private fsModuleCache: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private pathModuleCache: any = null;

  private async getFsModule() {
    if (!this.fsModuleCache) {
      this.fsModuleCache = await import(/* @vite-ignore */ '@tauri-apps/plugin-fs');
    }
    return this.fsModuleCache as typeof import('@tauri-apps/plugin-fs');
  }

  private async getPathModule() {
    if (!this.pathModuleCache) {
      this.pathModuleCache = await import(/* @vite-ignore */ '@tauri-apps/api/path');
    }
    return this.pathModuleCache as typeof import('@tauri-apps/api/path');
  }

  async read(path: string): Promise<string> {
    const resolved = await this.resolvePath(path);
    const { readTextFile, stat } = await this.getFsModule();
    const content = await readTextFile(resolved);
    try {
      const info = await stat(resolved);
      if (info.mtime) this.lastModified.set(path, info.mtime.getTime());
    } catch {
      // Non-critical — a failed stat here just means we skip conflict
      // detection next time this path is written.
    }
    return content;
  }

  async write(path: string, content: string): Promise<void> {
    const resolved = await this.resolvePath(path);
    const { writeTextFile, stat, mkdir } = await this.getFsModule();
    const { dirname } = await this.getPathModule();

    const knownMtime = this.lastModified.get(path);
    if (knownMtime !== undefined) {
      try {
        const info = await stat(resolved);
        const currentMtime = info.mtime?.getTime() ?? 0;
        if (currentMtime !== knownMtime) {
          throw new ExternalChangeError(path);
        }
      } catch (err) {
        if (err instanceof ExternalChangeError) throw err;
        // stat failed (file deleted, permissions, …) — fall through and write.
      }
    }

    this.writingInFlight.add(path);
    try {
      // `FileSystem.write`'s contract creates the parent directory if it's
      // missing — there's no separate public `mkdir` on this interface.
      const dir = await dirname(resolved);
      await mkdir(dir, { recursive: true }).catch(() => {});
      await writeTextFile(resolved, content);

      try {
        const info = await stat(resolved);
        if (info.mtime) this.lastModified.set(path, info.mtime.getTime());
      } catch {
        // Ignore — a failed stat here is non-critical.
      }
    } finally {
      this.writingInFlight.delete(path);
    }
  }

  async list(dirPath: string): Promise<string[]> {
    const resolved = await this.resolvePath(dirPath);
    const { readDir } = await this.getFsModule();
    try {
      const entries = await readDir(resolved);
      return entries.map(e => e.name);
    } catch {
      return [];
    }
  }

  async stat(path: string): Promise<FileStat> {
    const resolved = await this.resolvePath(path);
    const { stat } = await this.getFsModule();
    const info = await stat(resolved);
    return { mtimeMs: info.mtime?.getTime() ?? 0, isDirectory: info.isDirectory ?? false, isSymlink: info.isSymlink ?? false };
  }

  async delete(path: string): Promise<void> {
    const resolved = await this.resolvePath(path);
    const { remove } = await this.getFsModule();
    await remove(resolved);
    this.lastModified.delete(path);
  }

  // A file path fires when that file's mtime moves past what this instance
  // last saw. A directory path (a directory-mode workspace) is watched
  // recursively — projects live in subfolders, and a marker can be added to
  // or removed from any file — and fires for any `.md` change under it that
  // this instance didn't just write itself.
  watch(path: string, callback: (changedPath: string) => void): () => void {
    let stopped = false;
    let stopWatcher: (() => void) | undefined;

    (async () => {
      const resolved = await this.resolvePath(path);
      if (stopped) return;
      const { watch, stat } = await this.getFsModule();
      stopWatcher = await watch(
        resolved,
        async (event: unknown) => {
          try {
            const info = await stat(resolved);
            if (info.isDirectory) {
              if (await this.isExternalMarkdownChange(event, stat)) callback(path);
              return;
            }
            if (this.writingInFlight.has(path)) return;
            const currentMtime = info.mtime?.getTime() ?? 0;
            const known = this.lastModified.get(path);
            if (known !== undefined && currentMtime !== known) {
              this.lastModified.set(path, currentMtime);
              callback(path);
            }
          } catch {
            // Ignore transient errors from the watcher.
          }
        },
        { recursive: true },
      );
      if (stopped) stopWatcher?.();
    })().catch(() => {
      // Watching unavailable in this environment — silently skip.
    });

    return () => {
      stopped = true;
      stopWatcher?.();
    };
  }

  // Whether a directory-watch event is a change to a `.md` file that this
  // instance did not make. `event.paths` are resolved absolute paths; the
  // keys this instance tracks are the paths callers passed in, so a key
  // matches when the resolved path is that key, or ends with its
  // home/document-relative tail.
  private async isExternalMarkdownChange(
    event: unknown,
    stat: (p: string) => Promise<{ mtime?: Date | null }>,
  ): Promise<boolean> {
    const paths = (event as { paths?: string[] } | undefined)?.paths;
    if (!paths || paths.length === 0) return true; // can't tell — reload to be safe
    const matches = (resolved: string, key: string) => {
      const tail = key.replace(/^(~\/|\/)/, '');
      return resolved === key || resolved.endsWith(`/${tail}`);
    };

    for (const changed of paths.filter(p => /\.md$/i.test(p))) {
      if ([...this.writingInFlight].some(key => matches(changed, key))) continue;
      const ownKey = [...this.lastModified.keys()].find(key => matches(changed, key));
      if (ownKey === undefined) return true;
      try {
        const info = await stat(changed);
        if ((info.mtime?.getTime() ?? 0) !== this.lastModified.get(ownKey)) return true;
      } catch {
        return true; // deleted or unreadable: an external change
      }
    }
    return false;
  }

  private async resolvePath(filePath: string): Promise<string> {
    let resolvedPath: string;
    let expectedRoot: string | null = null;

    if (filePath.startsWith('~/')) {
      const { homeDir } = await this.getPathModule();
      const home = (await homeDir()).replace(/\/$/, '');
      resolvedPath = `${home}/${filePath.slice(2)}`;
      expectedRoot = home;
    } else if (filePath.startsWith('/')) {
      resolvedPath = filePath; // already absolute — trust the explicit path
    } else {
      const { documentDir } = await this.getPathModule();
      const docDir = (await documentDir()).replace(/\/$/, '');
      resolvedPath = `${docDir}/${filePath}`;
      expectedRoot = docDir;
    }

    if (expectedRoot !== null) {
      const normalized = this.normalizePosixPath(resolvedPath);
      const root = expectedRoot.replace(/\/$/, '');
      if (!normalized.startsWith(`${root}/`) && normalized !== root) {
        throw new Error(`Path traversal detected: "${filePath}" escapes expected directory`);
      }
    }

    return resolvedPath;
  }

  /** Normalize a POSIX path by resolving '.' and '..' segments in-place. */
  private normalizePosixPath(p: string): string {
    const parts = p.split('/');
    const out: string[] = [];
    for (const part of parts) {
      if (part === '..') {
        if (out.length > 1) out.pop();
      } else if (part !== '.') {
        out.push(part);
      }
    }
    return out.join('/');
  }
}
