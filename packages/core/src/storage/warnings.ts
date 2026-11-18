// A parse warning surfaced by a `WorkspaceHandle`, tagged with the file it
// came from (directory mode) — file mode has only one file, so `path` is
// omitted there. `ParseResult`/`ParseProjectResult` carry warnings as bare
// strings; this is that, plus provenance.
export interface WorkspaceWarning {
  path?: string;
  message: string;
  // Set on warnings that lint reports as structured findings of its own
  // (marker problems, duplicate names, dangling `projects:` entries), so it
  // doesn't report them twice.
  code?: 'marker' | 'duplicate-name' | 'missing-project';
}
