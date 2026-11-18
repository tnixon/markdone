import { TFile, TFolder, type App } from 'obsidian';
import type { FileStat, FileSystem } from '@markdone/core';

// core's `FileSystem` contract has no `mkdir`: `write` to a path whose
// parent doesn't exist is expected to create it. Walks from the root down
// so a multi-level missing path (unusual for a directory-mode workspace,
// but not disallowed) is created one folder at a time rather than relying
// on `createFolder` to recurse on its own. Exported (not a private method)
// so write.ts's own create-file case can reuse it without duplicating this.
export async function ensureParentFolder(app: App, path: string): Promise<void> {
  const lastSlash = path.lastIndexOf('/');
  if (lastSlash === -1) return;
  const dir = path.slice(0, lastSlash);
  let current = '';
  for (const segment of dir.split('/')) {
    current = current ? `${current}/${segment}` : segment;
    if (!app.vault.getFolderByPath(current)) {
      await app.vault.createFolder(current);
    }
  }
}

// Implements core's `FileSystem` over Obsidian's `Vault` API (never
// `vault.adapter` — the docs prefer `Vault` so the metadata cache and Sync
// stay coherent) rather than Node's `fs`, so a `WorkspaceHandle` built on
// this works on mobile as well as desktop.
//
// Two behaviors worth knowing about, both inherited from what core expects
// rather than chosen here:
//
// - `read` and `stat` THROW when the path is absent — `WorkspaceHandle`
//   implementations read that as "the file doesn't exist" (`FileWorkspaceHandle`
//   catches it; `DirectoryWorkspaceHandle`'s reload() relies on `stat`
//   throwing to detect a brand-new project file). Returning `null` instead
//   would silently break both.
// - `write` unconditionally overwrites, per the `FileSystem` contract — it
//   has no notion of "the file changed since I last read it". The plugin's
//   own mutation path (write.ts) deliberately does NOT go through this
//   method for that reason: it re-checks the live content against what a
//   preview was computed from, inside `vault.process`, before deciding what
//   to write. In practice this method is exercised by core's own
//   bookkeeping (e.g. `DirectoryWorkspaceHandle.reload()` creating a missing
//   `inbox.md`), not by the plugin's task mutations.
export class VaultFileSystem implements FileSystem {
  constructor(private readonly app: App) {}

  async read(path: string): Promise<string> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      throw new Error(`Markdone: no file at "${path}"`);
    }
    return this.app.vault.read(file);
  }

  async write(path: string, content: string): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFolder) {
      throw new Error(`Markdone: "${path}" is a folder, not a file`);
    }
    if (existing instanceof TFile) {
      await this.app.vault.process(existing, () => content);
      return;
    }
    await ensureParentFolder(this.app, path);
    await this.app.vault.create(path, content);
  }

  // Bare child names (files and folders alike), per the `FileSystem`
  // contract — `DirectoryWorkspaceHandle` filters by `stat(...).isDirectory`
  // itself. A missing folder is `[]`, not an error: a workspace folder that
  // doesn't exist yet is a valid starting state, not a failure.
  async list(dirPath: string): Promise<string[]> {
    const folder = this.app.vault.getFolderByPath(dirPath);
    if (!folder) return [];
    return folder.children.map(child => child.name);
  }

  async stat(path: string): Promise<FileStat> {
    const entry = this.app.vault.getAbstractFileByPath(path);
    if (entry instanceof TFile) return { mtimeMs: entry.stat.mtime, isDirectory: false };
    if (entry instanceof TFolder) return { mtimeMs: 0, isDirectory: true };
    throw new Error(`Markdone: no file or folder at "${path}"`);
  }

  // Routes through FileManager.trashFile, which honors the user's own
  // "Deleted files" preference (system trash, .trash/, or permanent) —
  // never a hard, unrecoverable delete of something in someone's vault.
  async delete(path: string): Promise<void> {
    const entry = this.app.vault.getAbstractFileByPath(path);
    if (!entry) throw new Error(`Markdone: no file or folder at "${path}"`);
    await this.app.fileManager.trashFile(entry);
  }
}
