/**
 * Minimal type stubs for Tauri v2 plugins and APIs.
 *
 * These declarations allow the project to type-check and compile without the
 * @tauri-apps packages installed in node_modules. They are purely for the
 * TypeScript compiler — they do NOT provide any runtime implementation.
 *
 * At Tauri build time the real native packages must be present (listed in
 * src-tauri/Cargo.toml and resolved by the Tauri CLI). If they are absent,
 * TypeScript will still compile successfully but the app will fail at runtime
 * when any of these APIs are called.
 */

declare module '@tauri-apps/plugin-fs' {
  export interface FileInfo {
    /** Last modification time */
    mtime?: Date;
    isDirectory?: boolean;
    isSymlink?: boolean;
  }

  export interface DirEntry {
    name: string;
    isDirectory: boolean;
    isFile: boolean;
    isSymlink: boolean;
  }

  export type UnwatchFn = () => void;

  export interface WatchOptions {
    recursive?: boolean;
    delayMs?: number;
  }

  export interface MkdirOptions {
    recursive?: boolean;
  }

  export interface RemoveOptions {
    recursive?: boolean;
  }

  export function readTextFile(path: string): Promise<string>;
  export function writeTextFile(path: string, contents: string): Promise<void>;
  export function stat(path: string): Promise<FileInfo>;
  export function readDir(path: string): Promise<DirEntry[]>;
  export function mkdir(path: string, options?: MkdirOptions): Promise<void>;
  export function remove(path: string, options?: RemoveOptions): Promise<void>;
  export function watch(
    path: string | string[],
    cb: (event: unknown) => void,
    options?: WatchOptions,
  ): Promise<UnwatchFn>;
}

declare module '@tauri-apps/plugin-store' {
  export interface Store {
    get<T>(key: string): Promise<T | null>;
    set(key: string, value: unknown): Promise<void>;
    save(): Promise<void>;
  }

  export interface StoreOptions {
    autoSave?: boolean | number;
  }

  export function load(path: string, options?: StoreOptions): Promise<Store>;
}

declare module '@tauri-apps/api/path' {
  export function homeDir(): Promise<string>;
  export function documentDir(): Promise<string>;
  export function dirname(path: string): Promise<string>;
}

declare module '@tauri-apps/plugin-dialog' {
  export interface OpenDialogOptions {
    multiple?: boolean;
    filters?: Array<{ name: string; extensions: string[] }>;
    defaultPath?: string;
  }
  export function open(options?: OpenDialogOptions): Promise<string | string[] | null>;

  export interface SaveDialogOptions {
    filters?: Array<{ name: string; extensions: string[] }>;
    defaultPath?: string;
  }
  export function save(options?: SaveDialogOptions): Promise<string | null>;
}
