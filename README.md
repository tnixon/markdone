# Markdone

A Markdown-backed task management app inspired by Todoist.

- **No server.** All data lives in `.md` files; cloud sync is handled externally (iCloud, Dropbox, etc.)
- **Pluggable storage.** The UI calls an `AppStorage` interface wrapping [`@markdone/core`](packages/core/README.md)'s `FileSystem` — it never touches the filesystem directly
- **Multiple workspaces.** In this app, each workspace is a separate `.md` file; the app presents a unified view. (`@markdone/core` also supports *directory-mode* workspaces — a folder, one note per project — used by the CLI, MCP server, and Obsidian plugin below; the desktop/web app doesn't build on that layer yet.)
- **Two project styles:** Checklist (flat task list) and Kanban (tasks grouped under column headings, declared via frontmatter in directory mode)
- **Five surfaces:** this app (browser dev server, embeddable widget, and Tauri desktop app), a CLI, an MCP server, an agent skill, and an Obsidian plugin — see [Packages](#packages) below

## Quick start

```bash
npm install
npm run dev        # start dev server at http://localhost:5173
npm test           # run test suite
npm run build      # production browser build → packages/app/dist/
npm run build:embed  # embeddable single-file bundle → packages/app/dist-embed/
```

For the Markdown file format and task syntax, see [TODO_FORMAT.md](TODO_FORMAT.md).
For implementation details, see [packages/app/src/README.md](packages/app/src/README.md) and [packages/app/src-tauri/README.md](packages/app/src-tauri/README.md).

## Packages

This is an npm workspaces monorepo — `npm install` at the repo root installs
every package's dependencies in one pass; nothing below needs its own
install step. Each package's own README has the full detail (configuration,
architecture, testing); this table is the quick reference for building and
running each one.

| Package | What it is | Build / run | Docs |
|---|---|---|---|
| `packages/app` | This app: browser dev server, embeddable widget, Tauri desktop shell | `npm run dev` · `npm run build` · `npm run build:embed` · `npm run tauri:dev` / `tauri:build` (see [Tauri desktop app](#tauri-desktop-app) below) | [src/README.md](packages/app/src/README.md), [src-tauri/README.md](packages/app/src-tauri/README.md) |
| `packages/core` | Framework-agnostic format logic (model, parser, serializer, operations) — no build step, ships raw TypeScript | `npm test -w @markdone/core` | [README.md](packages/core/README.md) |
| `packages/cli` | `markdone` command-line interface to the operations layer | `npm run build:cli` → `packages/cli/dist/markdone.cjs` | [README.md](packages/cli/README.md) |
| `packages/mcp` | MCP server exposing the operations registry as tools over stdio | `npm run build:mcp` → `packages/mcp/dist/markdone-mcp.cjs` | [README.md](packages/mcp/README.md) |
| `packages/toolkit` | Publishes `markdone` + `markdone-mcp` as one installable package — `npm install -g @markdone/toolkit`, no monorepo checkout | `npm run build:toolkit` → `packages/toolkit/dist/{markdone,markdone-mcp}.cjs` | [README.md](packages/toolkit/README.md) |
| `packages/skill` | The `markdone` [Agent Skill](https://agentskills.io/specification) — works in Claude Code, Hermes Agent, or any other Agent Skills host, alongside the `markdone` MCP server | `npm run build:skill` (regenerates its generated reference docs) | [README.md](packages/skill/README.md) |
| `packages/obsidian` | Obsidian plugin: token chips, a task query view, workspace commands | `npm run build:obsidian` → `packages/obsidian/main.js`, then symlink the folder into `<vault>/.obsidian/plugins/markdone/` | [README.md](packages/obsidian/README.md) |

`@markdone/cli`, `@markdone/mcp`, `@markdone/toolkit`, and `@markdone/obsidian`
all bundle `@markdone/core` (and its one dependency, `yaml`) into a single
self-contained file via esbuild — each `build.mjs` explains its own bundling
choices (e.g. the Obsidian plugin's `platform: 'browser'`, needed so `yaml`
never pulls in a dynamic `require()` that would break on mobile).
`@markdone/toolkit` bundles `@markdone/cli` and `@markdone/mcp`'s own source
a second time into its own bins, rather than depending on those packages'
builds, so the published standalone install has no runtime dependency on
either. `@markdone/skill` doesn't bundle anything at runtime — it's a plain
[Agent Skill](https://agentskills.io/specification) folder plus docs, and
depends on `@markdone/core` only at build time, to regenerate its operations
reference table. Root-level `npm test` (`--workspaces --if-present`) runs
every package's test suite in one pass — except `@markdone/toolkit`'s real
coverage for its own bundling (`test:smoke`), which packs and installs the
artifact for real and is deliberately excluded from that fast pass; see
[packages/toolkit/README.md](packages/toolkit/README.md).

## Releasing `@markdone/toolkit`

`@markdone/toolkit` is the only package in this monorepo published to npm —
`@markdone/core`/`cli`/`mcp`/`skill`/`obsidian`/`app` are all
`"private": true` and stay internal.

Prerequisite (one-time): an npm account/org with the `@markdone` scope
claimed, and `npm login` run locally with publish access to it. Without
one, use [Local install](#local-install-no-npm-publish) below instead.

1. `npm test && npm run typecheck` — full monorepo, must be clean.
2. Bump the version in `packages/toolkit/package.json` (semver). This is the
   version `markdone --version` and the MCP server's `initialize` response
   report — both are baked in at build time from this file, not hardcoded
   elsewhere.
3. `npm run build:toolkit`.
4. `npm run test:smoke -w @markdone/toolkit` — packs the just-built artifact,
   installs it into a throwaway prefix, and runs the installed binaries for
   real (`--version`, a query against a real fixture, a full MCP stdio
   handshake). Must pass before publishing — see
   [packages/toolkit/README.md](packages/toolkit/README.md).
5. `npm publish -w @markdone/toolkit` (the package's own
   `publishConfig.access: "public"` covers the scoped-public flag).
6. `git tag v<version> && git push --tags`.

### Release assets

Publishing a GitHub release for `v<version>` runs
[`release-assets.yml`](.github/workflows/release-assets.yml), which builds the
toolkit and attaches `markdone-toolkit-<version>.tgz` and `SHA256SUMS` to that
release. It fails, uploading nothing, if `packages/toolkit/package.json`'s
version doesn't match the tag.

- **Backfill or re-attach** (an older release, or after a failed run):
  `gh workflow run release-assets.yml --ref main -f tag=v<version>`. Run it
  from `main`: a manual run uses the workflow file from the ref you select.
- **Releases created by another workflow** with the default `GITHUB_TOKEN` do
  not fire `release: published`; use the backfill command for those.
- **Verifying a download:** `sha256sum -c SHA256SUMS` next to the tarball.
  Re-running the workflow replaces the assets and may change the hash, so a
  consumer that pins it must re-pin afterwards.
- **No-login downloads** (`releases/download/...`) work because the
  repository is public.

### Local install (no npm publish)

For personal use, with no npm account: pack the toolkit into a tarball and
install that globally.

1. Do steps 1–4 above (test + typecheck, bump version,
   `npm run build:toolkit`, `npm run test:smoke -w @markdone/toolkit`). The
   build must run first: unlike `npm publish`, `npm pack` does not run
   `prepublishOnly`, so it packs whatever is already in `dist/`.
2. `npm pack -w @markdone/toolkit` — writes
   `markdone-toolkit-<version>.tgz` to the repo root (gitignored).
3. `npm install -g ./markdone-toolkit-<version>.tgz` — puts `markdone` and
   `markdone-mcp` on `PATH`, the same as a registry install.
4. `markdone --version` should print the new version.

To upgrade, repeat with the new tarball. To remove:
`npm uninstall -g @markdone/toolkit`.

`npm pack` may warn that `bin[...] script name dist/*.cjs was invalid and
removed`. That is cosmetic: npm only strips the leading `./`, and both bins
still ship.

## Embedding Markdone in another page

After building the embed bundle (`npm run build:embed`), you get:

| File | Purpose |
|------|---------|
| `packages/app/dist-embed/markdone.iife.js` | Self-executing JS bundle (includes React) |
| `packages/app/dist-embed/style.css` | Extracted CSS |

### Option A — HTML attribute (auto-mount)

Add a container element with `data-markdone`, then load the bundle. The bundle
auto-mounts into every `[data-markdone]` element it finds.

```html
<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="markdone/style.css" />
  </head>
  <body>
    <div
      data-markdone
      data-storage="localstorage"
      data-theme="auto"
      style="height: 100vh;"
    ></div>
    <script src="markdone/markdone.iife.js"></script>
  </body>
</html>
```

Supported `data-*` attributes:

| Attribute | Values | Default |
|-----------|--------|---------|
| `data-storage` | `localstorage` | `localstorage` |
| `data-theme` | `light` \| `dark` \| `auto` | `auto` |

### Option B — JavaScript API

```html
<link rel="stylesheet" href="markdone/style.css" />
<div id="app" style="height: 100vh;"></div>
<script src="markdone/markdone.iife.js"></script>
<script>
  const handle = Markdone.mount(document.getElementById('app'), {
    storage: 'localstorage',
    theme: 'dark',
  });

  // To unmount later:
  // handle.unmount();
</script>
```

See `embed-example.html` for a complete working example.

## Tauri desktop app

Markdone includes a Tauri v2 desktop app that reads and writes real `.md` files
from disk. See [packages/app/src-tauri/README.md](packages/app/src-tauri/README.md) for full details.

### Prerequisites

- [Rust toolchain](https://www.rust-lang.org/tools/install) (stable)
- [Tauri CLI v2](https://v2.tauri.app/start/prerequisites/)
- Platform build tools (see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/))

### Generate app icons

```bash
# Place a 1024×1024 PNG source icon at app-icon.png, then:
npm run tauri icon app-icon.png
```

### Run the desktop app

```bash
npm run tauri:dev    # development (hot-reload)
npm run tauri:build  # production bundle
```

## Status

The follow-on work beyond the original app, in dependency order — all of it
shipped:

- **Core extraction.** Pull the parser, serializer, model, and operations layer
  out into a standalone package, decoupled from React and Tauri, so it can be
  reused by the surfaces below. ✅ `packages/core`.
- **CLI / MCP server.** Command-line and Model Context Protocol access to the
  operations layer, so agents and scripts can read and mutate workspaces
  without the UI. ✅ `packages/cli`, `packages/mcp`.
- **Agent skill.** Package the
  [markdone skill](packages/skill/markdone/SKILL.md)
  as a host-agnostic [Agent Skill](https://agentskills.io/specification),
  usable in Claude Code, Hermes Agent, or any other compliant host. ✅
  [`packages/skill`](packages/skill/README.md).
- **Obsidian plugin.** Native in-vault rendering and editing of Markdone
  projects, built on the [v2 file format](TODO_FORMAT.md) and its directory-mode
  workspace support. ✅ MVP: token chips, a task query view, and workspace
  commands — see [`packages/obsidian`](packages/obsidian/README.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues privately, as
described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
