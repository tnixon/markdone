// The filesystem-facing service `WorkspaceHandle` implementations depend on.
// A separate abstraction from `WorkspaceHandle` itself — nothing above
// `WorkspaceHandle` touches a `FileSystem` directly. `packages/app` supplies
// concrete implementations (Tauri-backed, localStorage-backed); this package
// only defines the interface plus an in-memory implementation for its own
// tests.
//
// No `mkdir` — `write` to a path whose parent doesn't exist creates it. No
// `rename` — project rename is a frontmatter `title` edit per spec, not a
// filesystem operation.

export interface FileStat {
  mtimeMs: number;
  isDirectory: boolean;
  // True when the path itself is a symbolic link. Optional: a filesystem with
  // no links (Obsidian's vault, the in-memory one) simply omits it. Directory
  // discovery never follows a link.
  isSymlink?: boolean;
}

export interface FileSystem {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  // Immediate children of `dirPath`, as relative names (not full paths).
  list(dirPath: string): Promise<string[]>;
  stat(path: string): Promise<FileStat>;
  delete(path: string): Promise<void>;
  // Returns an unsubscribe function. `callback` carries the changed path.
  // Watching a directory covers its whole subtree: a project may live in a
  // subfolder, and a marker can be added to or removed from any file.
  watch?(path: string, callback: (changedPath: string) => void): () => void;
}
