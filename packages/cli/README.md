# @markdone/cli

A command-line interface to the `@markdone/core` operations layer — read and
mutate Markdone workspaces (file mode and directory mode) from scripts,
shells, and session-start hooks, without the desktop app. Every subcommand
maps directly to an operation in
[`packages/core/src/operations/registry.ts`](../core/src/operations/registry.ts);
see [`TODO_FORMAT.md`](../../spec/TODO_FORMAT.md) for the file format itself.

## Install

```bash
npm install -g @markdone/toolkit
markdone --version
```

This installs both `markdone` and [`markdone-mcp`](../mcp/README.md) — see
[`@markdone/toolkit`](../toolkit/README.md), the published package they ship
from. `markdone` is a self-contained bundle (no runtime dependencies —
`@markdone/core` and `yaml` are built in); `markdone --version` reports the
installed package's version.

Developing this package inside the monorepo instead:

```bash
npm install
npm run build:cli
```

This produces `packages/cli/dist/markdone.cjs` directly (not the published
artifact — see `@markdone/toolkit` for that), for exercising local changes
without a full monorepo publish cycle.

## Quick example

```bash
markdone --workspace ~/vault/tasks list --context computer
markdone --workspace ~/vault/tasks add "Ship the release notes" --project Inbox --due 2026-04-10
markdone --workspace ~/vault/tasks done --task ^a3f9 --dry-run
markdone --workspace ~/vault/tasks done --task ^a3f9
markdone --workspace ~/vault/tasks summary
```

`--workspace` auto-detects file mode vs. directory mode by stat'ing the path
(no `.md` suffix and the path doesn't exist yet ⇒ a new directory workspace).
Repeat `--workspace <id>=<path>` to load several at once; a mutation or a
project-scoped query then needs `--in <id>` to pick one, unless only one is
loaded.

### Directory workspaces: which files are projects

In a directory workspace a project is any `.md` file under the folder, **at
any depth**, whose frontmatter has `markdone: 2`. An unmarked `.md` is an
ordinary note — never listed, never parsed as tasks, never written. Hidden
folders and symlinks are skipped; a file whose marker names an unsupported
version is reported and skipped. A project's name is its frontmatter `title`,
else its first H1, else (root file) its filename or (nested file) its
**parent folder's** name — so `home-network/todo.md` is "home-network".

`--project` takes a zero-based index, a project **path** (the
workspace-relative path without `.md`, e.g. `home-network/todo` — the same
form `_markdone.md`'s `projects:` uses), or a name. A name shared by several
projects is an error that lists their paths; a path is always unambiguous.
Resolution order is index, then path, then name. An all-digit locator is
always an index, so a project whose path or name is all digits (`2024.md`)
can't be addressed by it — give it a `title`, or address it by index. A path
wins over a name that happens to look like one. Names match exactly and
case-sensitively; a root project's path is its filename without `.md`, so a
script that addressed `groceries` by its filename keeps working.
`summary --json` carries each project's `path`, and every task in `list
--json` carries `project: { name, path }`.

A workspace of `.md` files with no marked project (one from before marker
discovery) makes `summary` and `list` say so on stderr rather than report an
empty workspace — add `markdone: 2` to each project file and to `inbox.md`,
or run `markdone lint`, which lists the candidates and offers the edit.

`project-add <name> --layout checklist|kanban` writes `<name>.md` at the
workspace root; add `--folder` for `<name>/todo.md` in its own folder. Both
carry the marker.

## Global flags

| Flag | Meaning |
|---|---|
| `--workspace <path>` / `--workspace <id>=<path>` | Repeatable. Loads a workspace, file or directory mode. |
| `--json` | Machine-readable output instead of the human-readable renderer. |
| `--owner <name>` | Default owner: applied as a `list` filter and folded into `add`/`add-subtask` as `#owner/<name>` unless a tag already sets one. |
| `--in <id>` | Picks which loaded workspace a mutation (or a project-scoped query) targets. |
| `--help` / `-h` | Prints top-level usage, or `<command> --help` for one command's usage. |
| `--version` | Prints the CLI version. |

### Workspace configuration via environment

`--workspace` isn't the only way to configure workspaces — in precedence
order:

1. **`--workspace <id>=<path>`** (repeatable) — if any are given, they're
   used exactly as given; nothing below applies.
2. **`MARKDONE_WORKSPACES=<id>=<path>,<id>=<path>,...`** (comma-separated) —
   used only when no `--workspace` flags were given at all. The same
   fallback [`@markdone/mcp`](../mcp/README.md) uses, and parsed identically
   by both.
3. **`MARKDONE_WORKSPACE=<path>`** (singular, one path, no id) — used only
   when neither of the above supplied anything. Falls back further to
   `./todo.md` if unset too — convenient for running `markdone <command>`
   from inside a vault directory with no flags or env at all.

Each level is all-or-nothing: `--workspace` and `MARKDONE_WORKSPACES` never
merge with each other or with the singular fallback.

Every mutating command also takes `--dry-run`, which prints the full-file
before/after diff `previewOperation` computed (every line, not hunk-windowed
— not `git apply`-able) without writing anything.

## Commands

Run `markdone <command> --help` for a command's full flag syntax — every
command below carries its own detailed usage string.

**Queries** — `overdue`, `due`, `context`, `tag`, `next`, `accuracy`,
`search`, `list`, `waiting`, `score`. Each maps to the query operation of the
same shape in the registry (e.g. `next` → `getNextActions`).

`list --score` adds a `score` object (`importance`, `urgency`, `risk`, `fit` —
exactly what `score` returns for that task) to every row. All rows are scored
in one pass from a single read of the workspaces, against one `today`, so the
scores are mutually consistent and cost one process instead of one per task.
Every `list` filter and `--workspace`/`--in` applies unchanged, and rows
without `--score` are unchanged. Rows are not sorted or combined into a single
number — ranking is the caller's job. In `--json` output the score is a
`score` key on each row; in text output it's a compact `{imp=… urg=… risk=…}`
suffix. (`score --task` and `list --score` share one code path, so they cannot
disagree.)

**Mutations** (each supports `--dry-run`) — task: `add`, `update`, `rm`,
`done`, `undone`, `cancel`, `move`, `reorder`, `add-subtask`, `update-subtask`,
`rm-subtask`, `assign-ids`; project: `project-add`, `project-update`,
`project-rm`, `project-reorder`; column: `column-add`, `column-rename`,
`column-rm`, `column-reorder`.

**Other** — `summary [--waiting-days N] [--as-of DATE]`: a session-start
orientation block (open counts by project, overdue, due-this-week, stale
waiting-fors, kanban projects with no open task under `Next`). `lint
[--strict]`: spec-conformance checks (malformed tokens, duplicate `^id`,
`#after/` to an unknown id, deprecated v1 syntax, open tasks with no `^id`,
invalid or unrecognized `_markdone.md` keys). Each finding has a severity —
`error`, `warn`, or `info` — and **`error` and `warn` findings already exit
`3` without `--strict`**; only `info` findings (e.g. an open task missing a
`^id`) are non-blocking by default. `--strict` promotes `info` to `warn`, so
a CI pipeline running plain `markdone lint` still fails on `warn`-level
findings such as deprecated v1 syntax — pass `--strict` to additionally fail
on `info`-level ones.

`commands.ts`'s `QUERY_COMMANDS`/`MUTATION_COMMANDS` tables are where a
command name is actually defined (each entry's `opName` names the registry
operation it targets); `COMMAND_NAMES` is a small index derived from both,
op-name → command-name, used by a test (`commandCoverage.test.ts`) that
asserts every non-batch registry operation has exactly one command — so a new
core operation fails this package's test suite until it's given one here.
`applyBatch` has no CLI command — see
[`@markdone/mcp`](../mcp/README.md), which exposes it behind the same
preview-then-confirm contract `--dry-run` gives you here.

## Exit codes

`0` success · `1` usage error (bad flag, missing required value) · `2`
workspace or operation error (a bad `--workspace` path, a concurrent external
edit, an operation `Result` failure like `TASK_NOT_FOUND`) · `3` blocking
`lint` findings.

## Testing

```bash
npm test
```

Tests run against `InMemoryFileSystem` (no disk I/O) seeded from
[`spec/corpus/`](../../spec/corpus/) via `@markdone/core/testing`, with a
fixed clock for deterministic date-based assertions.
