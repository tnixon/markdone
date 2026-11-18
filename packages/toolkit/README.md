# @markdone/toolkit

The standalone `markdone` CLI and `markdone-mcp` server, published as one
npm package with two bins — no monorepo checkout, no Claude Code. This is
what an agent host (Hermes, another MCP client, a plain shell script) or a
person installs to get both interfaces to Markdone workspaces.

## Install

```bash
npm install -g @markdone/toolkit
markdone --version
```

That's it — both `markdone` and `markdone-mcp` are now on `PATH`. Each is a
self-contained bundle (`@markdone/core` and, for `markdone-mcp`, the MCP SDK
are built in) — no runtime dependencies, no separate install step per binary.

## What's inside

This package doesn't re-document either interface — it just builds and
installs them:

- **`markdone`** — the command-line interface. Full command reference, exit
  codes, and flag syntax: [`packages/cli/README.md`](https://github.com/tnixon/markdone/blob/main/packages/cli/README.md).
- **`markdone-mcp`** — the MCP server exposing the same operations as tools
  over stdio. Tool naming and the preview-then-confirm contract every
  mutating tool follows: [`packages/mcp/README.md`](https://github.com/tnixon/markdone/blob/main/packages/mcp/README.md).

Both parse workspace configuration identically — repeatable `--workspace
<id>=<path>` flags, or `MARKDONE_WORKSPACES=<id>=<path>,<id>=<path>,...` as
an env fallback when no `--workspace` flags are given. See either linked
README for the full precedence rules.

## MCP client configuration

Generic client config — works with any MCP client that reads
`command`/`args`/`env`:

```json
{
  "mcpServers": {
    "markdone": {
      "command": "markdone-mcp",
      "args": ["--workspace", "personal=/Users/me/vault/tasks"],
      "env": {}
    }
  }
}
```

Or configure workspaces via environment instead of `args`, e.g. for a host
that prefers env-based config:

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
covered in [`packages/skill/README.md`](https://github.com/tnixon/markdone/blob/main/packages/skill/README.md),
not here — this config is the one every MCP client needs regardless of
which agent host it's for.

## Developing this package

This package has no source of its own beyond `build.mjs` — it bundles
`packages/cli/src/main.ts` and `packages/mcp/src/main.ts` (esbuild, CJS,
each with a `#!/usr/bin/env node` banner and the executable bit set) and
bakes this package's own `package.json` version into both bundles at build
time, which is what `markdone --version` and the MCP server's reported
version report.

```bash
npm run build -w @markdone/toolkit    # -> dist/markdone.cjs, dist/markdone-mcp.cjs
npm run test:smoke -w @markdone/toolkit
```

`npm test` here runs zero tests by design — the CLI's and MCP server's own
logic is tested in `packages/cli` and `packages/mcp`. `test:smoke` is the
real coverage for this package specifically: it packs the built `dist/`,
installs it into a throwaway prefix (`npm install -g --prefix <tmp>`, not
your real global install), and runs the installed binaries for real —
`--version`, a query against a real fixture workspace, and a full MCP
stdio handshake — proving the *published artifact* works, not just the
source. See [`smoke/install.smoke.test.ts`](https://github.com/tnixon/markdone/blob/main/packages/toolkit/smoke/install.smoke.test.ts).

See the root [README.md](https://github.com/tnixon/markdone/blob/main/README.md#releasing-markdonetoolkit) for the
full release checklist.
