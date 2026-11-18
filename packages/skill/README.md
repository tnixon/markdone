# `@markdone/skill`

The `markdone` [Agent Skill](https://agentskills.io/specification) — a
host-agnostic `SKILL.md` plus reference docs teaching an agent format v2
(token grammar, workspace modes, `^id` addressing, owner resolution, the
`score` model) and how to read/mutate a Markdone workspace correctly,
through either the `markdone_*` MCP tools or the `markdone` CLI. See
[`spec/TODO_FORMAT.md`](../../spec/TODO_FORMAT.md) for the format itself.

Unlike the Claude Code plugin this package replaces, this skill has no
product-specific glue — no slash commands, no `${CLAUDE_PLUGIN_ROOT}`, no
bundled binaries. It assumes `markdone` and `markdone-mcp` are already on
`PATH`.

**Migrating from the plugin:** the old `/plugin install` route (the
`.claude-plugin/` marketplace and plugin manifests) and the `/lint` and
`/summary` slash commands are gone. Install the skill directory as described
under [Claude Code](#a-claude-code) below; the slash commands live on as
plain workflows in
[`markdone/reference/workflow-lint.md`](markdone/reference/workflow-lint.md)
and
[`markdone/reference/workflow-summary.md`](markdone/reference/workflow-summary.md).
The example session-start hook is now under
[Optional: session-start hook](#optional-session-start-hook).

**Trust:** the skill runs whatever `markdone` / `markdone-mcp` resolve to on
your `PATH`. Install them from `@markdone/toolkit` and check
`which markdone` if in doubt.

## Prerequisite

```bash
npm install -g @markdone/toolkit
markdone --version
```

See [`packages/toolkit/README.md`](../toolkit/README.md) for what that
installs and how workspace configuration (`--workspace id=path`, or
`MARKDONE_WORKSPACES`) works — identical for the CLI and the MCP server,
and the same across every host below.

## Install

The skill is the [`markdone/`](markdone/) directory itself — copy or
symlink it into whichever folder your host scans for skills. **No archive
step**: every host below installs a skill as a plain directory (or, for a
single file, just `SKILL.md`), never a zip or tarball, so there's nothing
to build before installing.

### (a) Claude Code

1. Copy or symlink `markdone/` into a skills directory Claude Code scans:
   `~/.claude/skills/markdone/` (user-level) or `.claude/skills/markdone/`
   (project-level, inside the vault/repo you're working in).
2. Register the MCP server, either with the CLI:
   ```bash
   claude mcp add markdone --env MARKDONE_WORKSPACES=personal=$HOME/vault/tasks -- markdone-mcp
   ```
   or with a `.mcp.json` in the project:
   ```json
   {
     "mcpServers": {
       "markdone": {
         "command": "markdone-mcp",
         "env": { "MARKDONE_WORKSPACES": "personal=/Users/me/vault/tasks" }
       }
     }
   }
   ```
3. Run `/mcp` in a session to confirm `markdone` is connected with its
   tools listed.

### (b) Hermes Agent

1. Copy `markdone/` into `~/.hermes/skills/markdone/` (or a project-local
   `.hermes/skills/` / `.agents/skills/`), or install straight from this
   repo: `hermes skills install tnixon/markdone/packages/skill/markdone`.
   Installing from a bare URL to a single `SKILL.md` file instead would
   drop the `reference/` folder the skill links to — use a directory or
   repo-path install, not a lone-file URL.
2. Register the MCP server in `~/.hermes/config.yaml`:
   ```yaml
   mcp_servers:
     markdone:
       command: markdone-mcp
       env:
         MARKDONE_WORKSPACES: personal=/Users/me/vault/tasks
   ```
   or `hermes mcp add markdone`.
3. Hermes prefixes MCP tool names by server, so the tools show up as
   `mcp_markdone_markdone_*` (e.g. `mcp_markdone_markdone_list_tasks`), not
   the bare `markdone_*` names other hosts use — the skill already expects
   this and matches on the `markdone_*` suffix.

### (c) Any other Agent Skills host

Put `markdone/` wherever the host reads skills from, then register the MCP
server with whatever generic `mcpServers` config the host takes — see
[`packages/toolkit/README.md`](../toolkit/README.md#mcp-client-configuration)
for the `command`/`args`/`env` shape every stdio MCP client understands. If
the host has no MCP client, the skill falls back to the `markdone` CLI with
`--dry-run` previews on every mutation.

## Optional: session-start hook

A host that supports a session-start hook can run `markdone summary` up
front so the agent opens with orientation instead of a cold start. For
Claude Code, add to `.claude/settings.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "markdone --workspace personal=$HOME/vault/tasks --json summary"
          }
        ]
      }
    ]
  }
}
```

This is optional and not part of the skill install — a hook fires
unconditionally on every session, so it belongs in your own settings, with
your own workspace path(s), not in a shared skill file.

(Hermes Agent has a gateway-hook system with a `session:start` event, but
its hooks are Python callbacks that log or react to events rather than feed
output back to the model — confirm that before relying on it for the same
purpose there.)

## Developing this package

```bash
npm run build:skill   # regenerates markdone/reference/{operations,TODO_FORMAT}.md
npm test -w @markdone/skill
```

The vendored `markdone/reference/TODO_FORMAT.md` is a verbatim copy of
`spec/TODO_FORMAT.md`, so its relative links to other monorepo files (such as
the conformance corpus) resolve in this repo but not in an installed skill;
the link check in `skillFormat.test.ts` deliberately skips it.

`npm test` checks three things: the two generated reference files haven't
drifted from their source (same guard `@markdone/cli`'s
`commandCoverage.test.ts` gives the CLI), every task-line example in the
skill's docs parses under spec v2 with no warnings and in canonical token
order, and the `SKILL.md` frontmatter conforms to the Agent Skills format.

To run the upstream reference validator as well (needs network access to
fetch it):

```bash
uvx --from skills-ref agentskills validate markdone
```
