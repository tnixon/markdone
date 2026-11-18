# src-tauri/ — Tauri Desktop Shell

Implementation reference for the Markdone Tauri v2 desktop shell. The frontend code lives in `src/` — see [src/README.md](../src/README.md) for the frontend implementation details.

## What This Is

The Tauri v2 desktop shell that packages the Markdone web frontend as a native desktop application. It provides filesystem access (reading and writing real `.md` files) and a native window with a WebView.

## Source Files

```
src-tauri/
  src/
    lib.rs            — App initialization: loads tauri-plugin-fs and tauri-plugin-store,
                        configures the Tauri builder
    main.rs           — Platform entry point calling markdone_lib::run()
  tauri.conf.json     — Window config, bundle config, CSP
  capabilities/       — Tauri permission declarations for fs and store plugins
  Cargo.toml          — Rust dependencies
  icons/              — App icons, committed (regenerate via npm run tauri icon …)
```

## Key Configuration Notes

**`dragDropEnabled: false`** — Required in the window config for HTML5 drag-and-drop to work in the WebView. Without this, Tauri intercepts native drag events before the browser can handle them, causing kanban card drag operations to snap back to their origin.

**`beforeDevCommand: "npm run dev"`** — Tauri dev mode starts the Vite dev server automatically before opening the WebView.

**CSP** — The Content Security Policy in `tauri.conf.json` is restrictive. Any new external resources (fonts, CDN scripts) must be explicitly added to the CSP before they will load.

## Prerequisites

- [Rust toolchain](https://www.rust-lang.org/tools/install) (stable)
- Platform build tools — see [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)

## Running the Desktop App

```bash
npm run tauri:dev    # development with hot-reload
npm run tauri:build  # production bundle
```

These commands are defined in the top-level `package.json`.

## Generating App Icons

`src-tauri/icons/` is committed — `tauri::generate_context!()` embeds these
paths at compile time, so they must exist in a fresh checkout (including CI)
for the crate to build at all.

To regenerate them, place a 1024×1024 PNG source icon at `app-icon.png` in
the repo root, then:

```bash
npm run tauri icon app-icon.png
```

This regenerates all icon sizes in `src-tauri/icons/`; commit the result.

## How Workspace Files Work

`TauriFileSystem` (`src/storage/fileSystem.ts`) implements `@markdone/core`'s
`FileSystem` interface over `@tauri-apps/plugin-fs`, mapping workspace paths
to real files on disk. `TauriAppStorage` (`src/storage/appStorage.ts`) pairs
it with the workspace registry:

- Workspace configurations (ID → file path, name, color) are stored via `tauri-plugin-store` in the app's data directory (`markdone-workspace-configs.json`).
- The default first workspace uses `~/Documents/todo.md`.
- File paths can be absolute (`/Users/…`), home-relative (`~/…`), or relative to Documents.
- Path traversal is guarded: paths containing `..` that escape the expected root directory are rejected.

**External-change detection** — `TauriFileSystem.watch()` (part of the
`FileSystem` interface) watches a workspace file via `tauri-plugin-fs`'s own
`watch()`, suppressing events caused by its own in-flight writes. When
another process modifies a file (cloud sync, text editor), the app reloads
that workspace and notifies the user.

**Conflict-aware save** — Before writing, `TauriFileSystem` checks the
file's `mtime` against the last-known value and throws `ExternalChangeError`
(from `@markdone/core`) if it changed since the last read or write. The app
catches this, reloads the workspace, and notifies the user instead of
silently overwriting the external change.
