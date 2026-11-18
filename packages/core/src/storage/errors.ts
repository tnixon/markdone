/**
 * Thrown by a storage adapter when a workspace file was modified externally
 * between the last load and a save attempt. The caller should reload the
 * workspace and notify the user rather than overwriting the external change.
 */
export class ExternalChangeError extends Error {
  constructor(public readonly workspaceId: string) {
    super(`Workspace "${workspaceId}" was modified externally`);
    this.name = 'ExternalChangeError';
  }
}

// Thrown by resolveWorkspaces when a --workspace/workspace spec can't be
// loaded, or names a duplicate id. Consumer-neutral — every consumer
// (CLI, MCP) maps it to its own failure presentation.
export class WorkspaceError extends Error {}
