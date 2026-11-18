# @markdone/mcp

A Model Context Protocol server exposing the `@markdone/core` operations
registry as MCP tools over stdio, so any MCP-capable agent can read and
mutate Markdone workspaces without the desktop app or a shell. Every tool is
generated from
[`packages/core/src/operations/registry.ts`](../core/src/operations/registry.ts)
— see [`TODO_FORMAT.md`](../../spec/TODO_FORMAT.md) for the file format
itself, and [`@markdone/cli`](../cli/README.md) for the equivalent shell
interface.

## Install

```bash
npm install -g @markdone/toolkit
which markdone-mcp
```

This installs both `markdone-mcp` and [`markdone`](../cli/README.md) — see
[`@markdone/toolkit`](../toolkit/README.md), the published package they ship
from. `markdone-mcp` is a self-contained executable (no runtime dependencies
— `@markdone/core`, the MCP SDK, and `yaml` are built in), meant to be
launched by an MCP client (see below), not run directly from a shell — it has
no `--version` flag of its own; the version it reports is in its MCP
`initialize` response, taken from the same installed package version as
`markdone --version`.

Developing this package inside the monorepo instead:

```bash
npm install
npm run build -w @markdone/mcp
```

This produces `packages/mcp/dist/markdone-mcp.cjs` directly (not the
published artifact — see `@markdone/toolkit` for that), for exercising local
changes without a full monorepo publish cycle.

## Configuring workspaces

Every tool call names a workspace by a short id you choose; the server has no
default. Configure named workspaces with repeatable `--workspace
<id>=<path>` (file or directory mode, auto-detected the same way the CLI's
`--workspace` does; in directory mode a project is a `.md` file with
`markdone: 2` frontmatter at any depth — see the CLI README), or `MARKDONE_WORKSPACES=<id>=<path>,<id>=<path>,...` as
an env fallback when no `--workspace` flags are given — parsed identically to
[`@markdone/cli`](../cli/README.md#workspace-configuration-via-environment)'s
own env fallback (they share one implementation in `@markdone/core`). A
`--workspace` flag always wins outright over the env var; they never merge.

Generic MCP client config (works with any client reading
`command`/`args`/`env` — after a global install, `markdone-mcp` is on `PATH`,
so no absolute path is needed):

```json
{
  "mcpServers": {
    "markdone": {
      "command": "markdone-mcp",
      "args": [
        "--workspace", "personal=/Users/me/vault/tasks",
        "--workspace", "shared=/Users/me/shared/todo.md"
      ],
      "env": {}
    }
  }
}
```

Or via environment instead of `args`:

```json
{
  "mcpServers": {
    "markdone": {
      "command": "markdone-mcp",
      "args": [],
      "env": {
        "MARKDONE_WORKSPACES": "personal=/Users/me/vault/tasks,shared=/Users/me/shared/todo.md"
      }
    }
  }
}
```

Agent-specific setup (skill install, hook examples, per-host MCP config) is
covered in [`packages/skill/README.md`](../skill/README.md), not here.

## The preview-then-confirm contract

This is the one thing a client author needs to understand. Every tool takes
a `workspace` argument (which named workspace to operate on) in addition to
the underlying operation's own parameters. A mutating tool requires it — a
mutation always targets exactly one workspace. A query tool (e.g.
`markdone_list_tasks`) makes it optional: given, it scopes to that one
workspace; omitted, it spans every workspace configured on this server —
an agent that forgets to pass `workspace` on a query silently gets data
back from *all* of them, not an error, so treat every configured workspace
as within a query's trust boundary. A query executes immediately and
returns data.

A mutating tool (e.g. `markdone_add_task`, `markdone_apply_batch`) never
writes on a bare call:

1. **Call without `confirm`.** The server reloads the workspace, computes
   what the operation *would* write, and returns a human-readable diff plus
   a `token` — a hash of the workspace, operation, arguments, and the exact
   current content of every file the change touches. Nothing is written.
2. **Call again with `confirm: true` and that `token`.** The server reloads
   the workspace again, recomputes the token against the fresh content, and
   compares:
   - **Match** — the files are unchanged since step 1 — it applies the
     mutation and returns the applied diff.
   - **Mismatch** — something (a person, the desktop app, another agent)
     changed one of the covered files since step 1 — it returns an error
     *plus a fresh preview and a new token*, so the next call can simply
     retry with the new token rather than starting over.

The token is stateless: it carries no server-side session, so it survives a
server restart, and the only thing that invalidates it is the covered files'
content actually changing. A token computed from one call's arguments only
ever validates a retry of that *same* call — changing any argument between
preview and confirm produces a different hash and is rejected the same way a
concurrent edit is.

`markdone_apply_batch` goes through the identical contract for a whole
sequence of operations at once: one preview, one diff covering every step,
one token, applied atomically (a failing step rolls back all of them).

## Testing

```bash
npm test
```

Tests connect a real MCP `Client` to the server in-process via
`InMemoryTransport.createLinkedPair()` — no stdio, no subprocess — against an
`InMemoryFileSystem` seeded from [`spec/corpus/`](../../spec/corpus/) via
`@markdone/core/testing`.
