import { normalizePath, type App } from 'obsidian';
import { DirectoryWorkspaceHandle, type Project, type WorkspaceHandle } from '@markdone/core';
import { VaultFileSystem } from './vaultFileSystem';
import { reconcileBlockIds } from './blockIds';

export interface ManagedWorkspace {
  // The configured folder path doubles as the workspace id — the plugin's
  // settings have no separate "workspace name" concept, so there is nothing
  // else to use.
  id: string;
  folder: string;
  handle: WorkspaceHandle;
  // Which vault file each project lives in, keyed by object reference.
  // Rebuilt each reload from `Project.sourcePath`, which core's loader sets.
  projectFiles: Map<Project, string>;
  // The configured folder isn't in the vault (deleted, renamed, or never
  // existed). Such a workspace is never reloaded: reloading would write
  // `inbox.md` and so create the folder, which only the user may do.
  missing: boolean;
}

const RELOAD_DEBOUNCE_MS = 300;

// The folder setting used to be free text, so saved values may look like
// `projects/`, `/projects` or `./projects`; the vault only knows the
// normalized `projects`.
function normalizeFolder(folder: string): string {
  return normalizePath(folder.trim().replace(/^(\.\/)+/, ''));
}

// Owns one `DirectoryWorkspaceHandle` per configured folder, reloading a
// workspace after a debounced vault change under its folder — not on every
// keystroke, and not the other configured workspaces.
export class WorkspaceManager {
  private workspaces: ManagedWorkspace[] = [];
  private readonly reloadTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly fs: VaultFileSystem;

  constructor(
    private readonly app: App,
    private readonly onChange: () => void,
  ) {
    this.fs = new VaultFileSystem(app);
  }

  // Only workspaces whose folder exists in the vault.
  list(): ManagedWorkspace[] {
    return this.workspaces.filter(w => !w.missing);
  }

  find(id: string): ManagedWorkspace | undefined {
    return this.list().find(w => w.id === id);
  }

  missingFolders(): string[] {
    return this.workspaces.filter(w => w.missing).map(w => w.folder);
  }

  // Rebuilds the set of workspace handles from the configured folder list.
  // Called on load and whenever the settings tab's folder list changes.
  // Folders absent from the vault are kept but flagged missing, not created.
  async configure(folders: string[]): Promise<void> {
    this.dispose();
    this.workspaces = folders.map(normalizeFolder).map(folder => ({
      id: folder,
      folder,
      handle: new DirectoryWorkspaceHandle(folder, folder, this.fs),
      projectFiles: new Map(),
      missing: false,
    }));
    await this.reloadAll();
  }

  async reloadAll(): Promise<void> {
    for (const ws of this.workspaces) {
      await this.reloadOne(ws);
    }
    this.onChange();
  }

  private async reloadOne(ws: ManagedWorkspace): Promise<void> {
    ws.missing = !this.app.vault.getFolderByPath(ws.folder);
    if (ws.missing) {
      ws.projectFiles = new Map();
      return;
    }
    await ws.handle.reload();
    // Runs before mapping project files: assigning an id can add or move a
    // project's file mtime but never renames a file, so the mapping below
    // stays valid either way.
    await reconcileBlockIds(this.app, ws.handle, ws.folder);
    ws.projectFiles = this.mapProjectFiles(ws);
  }

  // Each project's vault path, from the workspace-relative path core records
  // on the project — so a project in a subfolder (`home-network/todo.md`) is
  // mapped like a root one.
  private mapProjectFiles(ws: ManagedWorkspace): Map<Project, string> {
    const map = new Map<Project, string>();
    for (const project of ws.handle.listProjects()) {
      if (project.sourcePath) map.set(project, `${ws.folder}/${project.sourcePath}`);
    }
    return map;
  }

  // A vault file/folder event for a path under one of the configured
  // folders debounces a reload of just that workspace.
  handleVaultEvent(path: string): void {
    const ws = this.workspaces.find(w => path === w.folder || path.startsWith(`${w.folder}/`));
    if (!ws) return;
    const existing = this.reloadTimers.get(ws.id);
    if (existing) clearTimeout(existing);
    this.reloadTimers.set(
      ws.id,
      setTimeout(() => {
        this.reloadTimers.delete(ws.id);
        void this.reloadOne(ws).then(() => this.onChange());
      }, RELOAD_DEBOUNCE_MS),
    );
  }

  dispose(): void {
    for (const timer of this.reloadTimers.values()) clearTimeout(timer);
    this.reloadTimers.clear();
  }
}
