// @markdone/core — public API.
//
// This package holds the format logic — model types, parser, serializer, and
// the operations layer — with no dependency on React, Tauri, or any browser
// API. Consumers (the desktop/web app, a future CLI, MCP server, or Obsidian
// plugin) depend on this package and supply their own storage/UI concerns.

// Model
export * from './model/types';
export * from './model/accessors';

// Parser / serializer
export { parse, parseProject, _resetIdCounter } from './parser/parse';
export type { ParseResult, ParseProjectOptions, ParseProjectResult } from './parser/parse';
export { serialize, serializeProject } from './parser/serialize';
export {
  parseFrontmatter,
  serializeFrontmatter,
  updateFrontmatterKey,
  classifyMarker,
  addMarkerToContent,
  SUPPORTED_MARKER_VERSIONS,
  CURRENT_MARKER_VERSION,
} from './parser/frontmatter';
export type { MarkerStatus } from './parser/frontmatter';
export {
  tokenizeTaskLine,
  parseEffort,
  parseActual,
  escapeDescription,
  parseCheckboxLine,
  locateTaskLineTokens,
} from './parser/tokenize';
export type { TokenizeResult, CheckboxLine, TaskLineToken } from './parser/tokenize';

// Storage abstraction
export { ExternalChangeError, WorkspaceError } from './storage/errors';

// FileSystem + WorkspaceHandle — the v2 storage layer. `FileSystem` is
// implemented per-platform by consumers (packages/app supplies Tauri- and
// localStorage-backed versions); `InMemoryFileSystem` is this package's own
// test double. `FileWorkspaceHandle`/`DirectoryWorkspaceHandle` are the two
// `WorkspaceHandle` implementations, built only on the `FileSystem`
// interface.
export type { FileSystem, FileStat } from './storage/fileSystem';
export { InMemoryFileSystem } from './storage/inMemoryFileSystem';
export type { WorkspaceHandle } from './storage/workspaceHandle';
export { FileWorkspaceHandle } from './storage/fileWorkspaceHandle';
export { DirectoryWorkspaceHandle } from './storage/directoryWorkspaceHandle';
export type { FileChange, OperationPreview } from './storage/changes';
export type { WorkspaceWarning } from './storage/warnings';
export type { DiscoveryReport, DiscoveredFile, SkippedFile, UnmarkedNote } from './storage/discovery';

// Shared by every Node consumer (CLI, MCP server): resolving `--workspace`
// specs into loaded handles, assembling a multi-workspace query AppState,
// and formatting a FileChange as a unified diff for a preview.
export type { WorkspaceSpec, ResolvedWorkspace } from './storage/resolveWorkspaces';
export { parseWorkspaceSpec, parseWorkspacesFromEnv, resolveWorkspaces, buildQueryState } from './storage/resolveWorkspaces';
export { formatDiff } from './storage/diff';

// Operations layer (task/project/query/batch ops + registry)
export * from './operations';

// Lint — spec-conformance checks shared by every consumer (the CLI's `lint`
// command and the Obsidian plugin's lint command report identical findings
// because both call this, rather than each keeping its own copy of the
// rules).
export {
  lintWorkspaces,
  effectiveSeverity,
  hasBlockingFindings,
  renderLintFindings,
} from './lint/lint';
export type { LintFinding, Severity } from './lint/lint';
