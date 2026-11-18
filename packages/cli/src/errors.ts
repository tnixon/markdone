// Thrown for a bad invocation (unknown flag, missing required value, bad
// combination) — caught by run() and mapped to exit code 1. `WorkspaceError`
// (a --workspace path that can't be loaded, or a duplicate id) now comes from
// @markdone/core, since resolveWorkspaces lives there.
export class UsageError extends Error {}
