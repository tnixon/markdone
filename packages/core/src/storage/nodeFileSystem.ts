import { promises as fsp, statSync, watch as fsWatch } from 'node:fs';
import * as path from 'node:path';
import type { FileStat, FileSystem } from './fileSystem';

// Node.js-backed `FileSystem`, for a CLI or MCP server running under Node.
// Not exported from the main barrel — see ../node.ts — since importing
// node:fs/node:path from the package's browser-facing entry point would
// break the web/Tauri build.
export class NodeFileSystem implements FileSystem {
  async read(filePath: string): Promise<string> {
    return fsp.readFile(filePath, 'utf8');
  }

  // Creates missing parent directories — the FileSystem contract has no
  // `mkdir` (see fileSystem.ts), so `write` is expected to create them.
  async write(filePath: string, content: string): Promise<void> {
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(filePath, content, 'utf8');
  }

  // Bare child names, matching the interface contract — not full paths. A
  // missing directory is reported as empty rather than thrown, so a brand
  // new workspace directory can be bootstrapped by writing into it.
  async list(dirPath: string): Promise<string[]> {
    try {
      return await fsp.readdir(dirPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  async stat(filePath: string): Promise<FileStat> {
    const stats = await fsp.stat(filePath);
    // `isDirectory`/`mtimeMs` describe what the path resolves to (so a
    // workspace root that is itself a symlink still works); `isSymlink` is
    // what directory discovery uses to refuse to follow links beneath it.
    const link = await fsp.lstat(filePath);
    return { mtimeMs: stats.mtimeMs, isDirectory: stats.isDirectory(), isSymlink: link.isSymbolicLink() };
  }

  async delete(filePath: string): Promise<void> {
    await fsp.unlink(filePath);
  }

  // Recursive: projects may live in subfolders, and a marker can be added to
  // or removed from any file under the workspace root.
  watch(watchPath: string, callback: (changedPath: string) => void): () => void {
    const recursive = statSync(watchPath, { throwIfNoEntry: false })?.isDirectory() ?? false;
    const watcher = fsWatch(watchPath, { recursive }, (_event, fileName) => {
      callback(fileName ? path.join(watchPath, fileName) : watchPath);
    });
    return () => watcher.close();
  }
}
