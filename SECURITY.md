# Security Policy

## Reporting a vulnerability

Please report security issues privately through GitHub's
[private vulnerability reporting](https://github.com/tnixon/markdone/security/advisories/new)
rather than a public issue. Include the affected package, the version, and
steps to reproduce.

## Supported versions

Only the latest `0.1.x` release receives fixes.

## Scope

Markdone has no server; the areas most relevant to security are:

- **CLI and MCP server** (`@markdone/toolkit`): they read and write the
  workspace files you point them at, including through `MARKDONE_WORKSPACES`
  and `--workspace`. Anything that lets them touch files outside a
  configured workspace is in scope.
- **Tauri desktop app**: its filesystem capabilities
  (`packages/app/src-tauri/capabilities/`) and content security policy.
- **Obsidian plugin**: vault file access.
