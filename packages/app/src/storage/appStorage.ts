import type { WorkspaceConfig, FileSystem } from '@markdone/core';
import { LocalStorageFileSystem } from './localStorage';
import { TauriFileSystem } from './fileSystem';

/**
 * Everything the app needs from storage: a `FileSystem` for workspace file
 * content, plus the workspace registry (which files/workspaces exist). The
 * registry is a separate, small, app-specific concern — it isn't workspace
 * *content* in the sense `FileSystem`/`WorkspaceHandle` (packages/core) deal
 * with, so it keeps its own persistence per platform (a dedicated
 * localStorage key on the web, Tauri's plugin-store on desktop) rather than
 * being stored as just another file, which would otherwise put app config
 * inside the user's visible Documents folder.
 */
export interface AppStorage {
  readonly fs: FileSystem;
  getWorkspaceConfigs(): Promise<WorkspaceConfig[]>;
  saveWorkspaceConfigs(configs: WorkspaceConfig[]): Promise<void>;
}

/**
 * The single workspace every fresh install starts with, used by both
 * `AppStorage` implementations below and by `useTodoOperations`'s own
 * empty-configs fallback (reachable on the `LocalAppStorage` build, since
 * unlike `TauriAppStorage` it never synthesizes a default itself).
 */
export const DEFAULT_WORKSPACE_CONFIG: WorkspaceConfig = {
  id: 'default',
  name: 'My Tasks',
  filePath: '~/Documents/todo.md',
  color: '#6366f1',
};

const CONFIGS_KEY = 'markdone:workspace-configs';

/** Browser / embed build: content via `LocalStorageFileSystem`, registry in a plain localStorage key. */
export class LocalAppStorage implements AppStorage {
  readonly fs = new LocalStorageFileSystem();

  async getWorkspaceConfigs(): Promise<WorkspaceConfig[]> {
    const raw = localStorage.getItem(CONFIGS_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      if (
        !Array.isArray(parsed) ||
        !parsed.every(
          item => item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.filePath === 'string',
        )
      ) {
        return [];
      }
      return parsed as WorkspaceConfig[];
    } catch {
      return [];
    }
  }

  async saveWorkspaceConfigs(configs: WorkspaceConfig[]): Promise<void> {
    localStorage.setItem(CONFIGS_KEY, JSON.stringify(configs));
  }
}

const STORE_PATH = 'markdone-workspace-configs.json';

/** Tauri desktop app: content via `TauriFileSystem`, registry in Tauri's plugin-store (app preferences, not a visible file). */
export class TauriAppStorage implements AppStorage {
  readonly fs = new TauriFileSystem();

  /** Cached workspace configs so we don't re-read the store on every call. */
  private configsCache: WorkspaceConfig[] | null = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private storeHandle: any = null;

  private async getStore() {
    if (!this.storeHandle) {
      const { load } = await import(/* @vite-ignore */ '@tauri-apps/plugin-store');
      this.storeHandle = await load(STORE_PATH, { autoSave: true });
    }
    return this.storeHandle as import('@tauri-apps/plugin-store').Store;
  }

  async getWorkspaceConfigs(): Promise<WorkspaceConfig[]> {
    if (this.configsCache) return this.configsCache;

    const store = await this.getStore();
    const stored = await store.get<WorkspaceConfig[]>('configs');

    if (!stored || stored.length === 0) {
      const defaults = [DEFAULT_WORKSPACE_CONFIG];
      this.configsCache = defaults;
      return defaults;
    }

    this.configsCache = stored;
    return stored;
  }

  async saveWorkspaceConfigs(configs: WorkspaceConfig[]): Promise<void> {
    this.configsCache = configs;
    const store = await this.getStore();
    await store.set('configs', configs);
    await store.save();
  }
}
