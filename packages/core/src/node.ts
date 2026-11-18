// @markdone/core/node — Node.js-only entry point.
//
// Kept separate from the main barrel (./index.ts) so nothing here reaches a
// browser bundle: NodeFileSystem imports node:fs and node:path, which don't
// exist in that environment. A CLI or MCP server running under Node imports
// from here for its FileSystem implementation; everything else (model,
// parser, operations, WorkspaceHandle) still comes from '@markdone/core'.
export { NodeFileSystem } from './storage/nodeFileSystem';
