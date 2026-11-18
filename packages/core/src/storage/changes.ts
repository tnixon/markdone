// A change to a single file, computed without writing it — the shared shape
// `WorkspaceHandle.previewOperation` returns and `applyOperation` executes.
// `before`/`after` are full serialized file contents (not a line-level diff);
// a consumer that wants a textual diff computes it from these two strings.
export interface FileChange {
  path: string;
  // null before = the file is being created; null after = it's being deleted.
  before: string | null;
  after: string | null;
}

export interface OperationPreview {
  description: string;
  changes: FileChange[];
}
