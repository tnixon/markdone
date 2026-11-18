# @markdone/core

Framework-agnostic format logic for Markdone: the v2 data model, parser,
serializer, operations layer, and a filesystem-backed storage layer — no
dependency on React, Tauri, or any browser API. See
[`spec/TODO_FORMAT.md`](../../spec/TODO_FORMAT.md) for the file format this
package reads and writes.

Consumers (the desktop/web app, `@markdone/cli`, a future MCP server or
Obsidian plugin) depend on this package and supply their own storage/UI
concerns.

## Entry points

- **`@markdone/core`** — model, parser, serializer, operations, and the
  `WorkspaceHandle`/`FileSystem` interfaces. Safe for a browser bundle.
- **`@markdone/core/node`** — `NodeFileSystem`, a `node:fs`-backed
  `FileSystem`. Kept off the main barrel so nothing here reaches a browser
  build; a CLI or MCP server running under Node imports from here in addition
  to the main entry point.
- **`@markdone/core/testing`** — `spec/corpus/` fixture-loading helpers
  (`loadCorpusFile`, `seedFileModeFixture`, `seedDirectoryModeFixture`) for a
  Node consumer's own test suite. Test-only: touches `node:fs` directly
  rather than going through `FileSystem`, so it's kept off both other entry
  points.

The package ships raw TypeScript (`"main": "./src/index.ts"`, `noEmit: true`
in its `tsconfig.json`) — there is no build step. A consumer that isn't
already running through a bundler (Vite, esbuild) needs one of its own.

## Layering

```
model (types.ts, accessors.ts)
  ↑
parser (parse.ts / serialize.ts, parseProject / serializeProject)
  ↑
operations (taskOps, projectOps, queryOps, batchOps, registry.ts)
  ↑
storage (FileSystem, WorkspaceHandle)
```

Each layer depends only on the ones below it. `operations/registry.ts` is the
main integration surface for a new consumer: `runOperation(name, state, input)`
dispatches by name, `toAnthropicTools()` produces tool schemas, and
`toMarkdownReference()` produces human-readable docs — all derived from the
same `operationRegistry`, so nothing needs to be hand-mapped per consumer.

## Two workspace modes, one task syntax

A workspace is either **one file** (`parse`/`serialize`, `# Heading`-delimited
projects, workspace-level frontmatter) or **one directory**
(`parseProject`/`serializeProject`, one `.md` file per project,
project-level frontmatter, `_markdone.md` for workspace defaults and
project ordering). In directory mode a project is any `.md` file, at any
depth, whose frontmatter carries the `markdone: 2` marker; unmarked notes are
ordinary notes. That rule lives in one place — `storage/discovery.ts`, used
only by `DirectoryWorkspaceHandle.reload()` — so every consumer gets it.
`classifyMarker`/`addMarkerToContent` are exported for consumers that see one
note at a time (an editor plugin, an agent handed a single file), and
`handle.discoveryReport()` says what was found: marked projects, files skipped
for an unsupported marker, and unmarked notes. A project's file is
`Project.sourcePath` (workspace-relative, `.md` included). See the spec for the full rules — nothing in the model
types (`Project`, `Task`, `Block`, ...) distinguishes the two; the mode lives
entirely in which parser entry point and which `WorkspaceHandle` a consumer
uses.

## `WorkspaceHandle`

`FileWorkspaceHandle` and `DirectoryWorkspaceHandle` are the two
`WorkspaceHandle` implementations, both built only on the `FileSystem`
interface:

```ts
const handle = new DirectoryWorkspaceHandle('my-ws', '/path/to/dir', new NodeFileSystem());
await handle.reload();               // required before any read

handle.listProjects();               // Project[]
handle.warnings();                   // parse warnings from the last reload()
handle.toWorkspace();                // assemble a read-only Workspace, for
                                      // multi-workspace queries via runOperation

const preview = await handle.previewOperation(op, input); // Result<OperationPreview>
// preview.value.changes: FileChange[] — before/after text per file, unwritten

const result = await handle.applyOperation(op, input);    // Result<void> — writes
```

`previewOperation` and `applyOperation` share the same planning logic, so a
preview always matches what a subsequent apply writes. Both throw
`ExternalChangeError` from `applyOperation` if a file's mtime changed since
the handle last read it — the caller should reload and retry rather than
overwrite.

`toWorkspace()` is read-only: assemble a multi-workspace `AppState` from it to
run query operations (`getOverdueTasks`, `listTasks`, ...) across several
handles, but route every mutation through `applyOperation`/`previewOperation`
on the specific handle that owns it.

## Shared consumer helpers

Small pieces above `WorkspaceHandle` that every agent-facing consumer builds
on rather than reimplementing. Despite the name, nothing here is Node-only —
each takes a `FileSystem`, so they work equally well over `@markdone/cli`'s
real-disk one and the Obsidian plugin's Vault-backed one.

- **`resolveWorkspaces(specs, fs, env)`** — turns `{ id?, path }` specs (from
  a repeatable `--workspace <id>=<path>` flag, however a consumer parses it)
  into loaded `ResolvedWorkspace[]`, auto-detecting file vs. directory mode by
  stat'ing each path. `parseWorkspaceSpec(spec)` parses the `<id>=<path>`
  string form. Used by `@markdone/cli` and `@markdone/mcp`; the Obsidian
  plugin skips it since its workspace folders come pre-resolved from settings.
- **`buildQueryState(resolved)`** — assembles a read-only, multi-workspace
  `AppState` from several resolved handles, for `runOperation`'s pan-workspace
  queries. Used by `@markdone/cli`, `@markdone/mcp`, and the Obsidian plugin.
- **`formatDiff(path, before, after)`** — a `---`/`+++`-headed before/after
  diff of one `FileChange`, for previewing a mutation before it writes.
  Every line, not hunk-windowed — readable, not `git apply`-able.
- **`lintWorkspaces(resolved, state, fs)`** (`@markdone/core`'s `lint/`
  module) — the spec-conformance checks behind `markdone lint` and the
  Obsidian plugin's "Run lint on workspace" command: parser warnings
  classified by severity, duplicate `^id`, an `#after/` reference to an
  unknown id, and `_markdone.md` key validation. `effectiveSeverity`/
  `hasBlockingFindings`/`renderLintFindings` round out the same contract
  both consumers use for exit codes and display. Moved here from the CLI so
  every consumer reports identical findings from one rule set.

## Testing

```bash
npm test           # single pass
npm run test:watch # watch mode
```

Vitest, `environment: 'node'`, globals enabled. Tests live in `__tests__/`
directories next to the module they cover. `spec/corpus/` is the normative
conformance suite for the file format — see
[`spec/corpus/README.md`](../../spec/corpus/README.md) — exercised by
`src/__tests__/corpus.test.ts`.
