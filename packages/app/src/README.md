# src/ — Frontend Implementation Reference

Implementation reference for the Markdone frontend. Audience: developers and contributing agents working on the codebase.

## Directory Layout

The model, parser, serializer, and operations layer used to live under this
`src/`, but were extracted into [`@markdone/core`](../../core/README.md) (see
the root README's Roadmap: "Core extraction") so `@markdone/cli`,
`@markdone/mcp`, the Markdone agent skill, and the Obsidian plugin could all
share them. This app now depends on `@markdone/core` like any other
consumer — there is no local `model/`, `parser/`, or `operations/` directory
anymore.

```
src/
  ai/
    systemPrompt.ts           — System prompt for the embedded AI assistant (v2 token syntax and ^id addressing)
    anthropicClient.ts        — Client-side call to the Anthropic API
    toolBridge.ts             — Maps @markdone/core's toAnthropicTools() output to executable calls against local AppState
    context.ts                — React context for the AI chat panel
  storage/
    appStorage.ts             — AppStorage interface + LocalAppStorage/TauriAppStorage (see "Storage Adapter Pattern" below)
    fileSystem.ts             — TauriFileSystem: @markdone/core's FileSystem over @tauri-apps/plugin-fs (dynamic imports, @vite-ignore)
    localStorage.ts           — LocalStorageFileSystem: @markdone/core's FileSystem over browser localStorage
    context.tsx               — StorageProvider / useStorage()
  hooks/
    useTodoOperations.ts      — All React state management: load, mutate, undo, save, notifications — calls @markdone/core's operation functions and parse()/serialize() directly
  components/
    Sidebar.tsx               — Navigation: Inbox, Smart Views, project list, workspace settings
    TaskList.tsx              — Checklist project view
    KanbanBoard.tsx           — Kanban project view with drag-and-drop
    TaskItem.tsx              — Single task row (checklist and kanban)
    TaskDetailPanel.tsx       — Expanded single-task editor
    EffortInput.tsx           — ~effort token input control
    SmartView.tsx             — Aggregated views (Overdue, Due This Week, Next Actions)
    AiChat/                   — Embedded AI assistant panel
    DueDatePicker.tsx         — Natural-language date input
    KeyboardShortcutsHelp.tsx — Keyboard shortcuts overlay
  App.tsx                     — Root shell: layout, routing between views, keyboard shortcuts
  main.tsx                    — Entry point; detects Tauri (__TAURI_INTERNALS__) → TauriAppStorage, else LocalAppStorage
  embed.tsx                   — Embeddable bundle entry point
  tauri-api.d.ts              — Ambient type stubs for @tauri-apps/* (no runtime dep in web build)
```

Note: this app currently exercises only **file-mode** workspaces (one `.md`
file per workspace, via `@markdone/core`'s `parse()`/`serialize()`) — it
doesn't yet build on the `WorkspaceHandle`/directory-mode layer that
`@markdone/cli`, `@markdone/mcp`, and the Obsidian plugin use. See
[`@markdone/core`'s README](../../core/README.md) for both workspace modes.

## Architecture

The codebase is organized in clear layers, each depending only on layers below it:

```
┌───────────────────────────────────────────┐
│              React Components              │
│   (Sidebar, TaskList, KanbanBoard, …)      │
├─────────────────────────────────────────────┤
│           useTodoOperations hook           │
│    (state, undo stack, save, reload)       │
├─────────────────────────────────────────────┤
│               @markdone/core               │
│  (model, parser/serializer, operations —   │
│   imported, not owned by this package)     │
├─────────────────────────────────────────────┤
│              Storage Adapter               │
│   (AppStorage → @markdone/core FileSystem) │
└─────────────────────────────────────────────┘
```

**Storage adapter** — `AppStorage` (`storage/appStorage.ts`) decouples the UI
from any specific backend: it pairs a `@markdone/core` `FileSystem`
implementation (workspace file *content*) with small app-specific
persistence for the workspace registry itself (which files/workspaces
exist). At runtime, `main.tsx` detects whether the app is running inside
Tauri (`window.__TAURI_INTERNALS__`) and constructs `TauriAppStorage` or
`LocalAppStorage` accordingly.

**`@markdone/core`** — model types, `parse()`/`serialize()`, and the
operations layer all come from this dependency now, not from local source.
`useTodoOperations` calls `parse()`/`serialize()` and the individual
operation functions (`addTask`, `completeTask`, ...) directly against the
`AppState` it holds. See [`@markdone/core`'s README](../../core/README.md)
for the package's own layering, and
[SKILL.md](../../skill/markdone/SKILL.md) for
the operations reference.

**`useTodoOperations` hook** — Owns all mutable state. Wraps operations in load/save cycles, maintains an undo stack, handles external-change reloads, and dispatches notifications.

**Components** — React UI that calls the hook. Components never call storage or `@markdone/core` directly.

## Storage Adapter Pattern

The `AppStorage` interface (`storage/appStorage.ts`) is small on purpose:

```typescript
interface AppStorage {
  readonly fs: FileSystem;               // from @markdone/core — workspace file content
  getWorkspaceConfigs(): Promise<WorkspaceConfig[]>;
  saveWorkspaceConfigs(configs: WorkspaceConfig[]): Promise<void>;
}
```

The workspace registry (id → file path, name, color) is kept separate from
file *content* deliberately: it isn't something `FileSystem`/`WorkspaceHandle`
(`@markdone/core`) deal with, and storing it as just another file would put
app configuration inside the user's visible Documents folder. Each
implementation persists it per platform instead.

Two implementations:
- **`LocalAppStorage`** — `fs` is `LocalStorageFileSystem` (browser
  `localStorage`); the registry lives in a plain `localStorage` key. Used by
  the web build and the embed bundle.
- **`TauriAppStorage`** — `fs` is `TauriFileSystem` (real `.md` files via
  `@tauri-apps/plugin-fs`); the registry lives in `tauri-plugin-store`'s
  app-data JSON, not a visible file. Used by the desktop app.

Tests use a third, defined locally where needed (e.g.
`components/__tests__/App.test.tsx`): `InMemoryAppStorage`, wrapping
`@markdone/core`'s own `InMemoryFileSystem` — there's no shipped
`src/storage/inMemory.ts`, since the test double is thin enough to define
inline.

**Tauri detection at runtime** (`main.tsx`):
```typescript
const isTauri = Boolean((window as Record<string, unknown>).__TAURI_INTERNALS__);
const storage = isTauri ? new TauriAppStorage() : new LocalAppStorage();
```

**Why `@vite-ignore`** — `TauriFileSystem` and `TauriAppStorage` use `/* @vite-ignore */` comments on their dynamic imports for `@tauri-apps/plugin-fs`, `@tauri-apps/api/path`, and `@tauri-apps/plugin-store`. This suppresses Vite's static analysis warnings. The packages must still be installed as devDependencies for Vite's build-time resolution to succeed.

## Operations Layer

All mutations go through `@markdone/core`'s operation functions — this app
holds no copy of them. See
[SKILL.md](../../skill/markdone/SKILL.md) for
the complete reference, including parameter shapes for all 31 operations,
and [`@markdone/core`'s README](../../core/README.md) for the package's own
layering (`operations/registry.ts` is the integration surface: `runOperation`,
`toAnthropicTools()`, `toMarkdownReference()`).

Every operation follows the same shape:
```typescript
function someOperation(state: AppState, ...params): Result<AppState> {
  // validate inputs → return err(...) if invalid
  // compute new state immutably
  // return ok(newState)
}
```

`useTodoOperations` calls these directly (e.g. `addTask(appState, ...)`),
takes the resulting `AppState`, serializes the affected workspace with
`serialize()`, and writes it through the active `AppStorage`'s `fs`.

## Inbox Invariant

Every `TodoFile` always has `projects[0]` as the Inbox checklist project. This is enforced in two places, both in `@markdone/core`:

1. **`parser/parse.ts`'s `ensureInbox()`** — called at the end of every `parse()` invocation. Handles: missing Inbox (prepends empty one), misplaced Inbox (promotes to first), kanban Inbox (per v2, reported as an error with content preserved rather than silently replaced — see the format spec's "The Inbox").

2. **`operations/projectOps.ts`** — guards at the operations layer:
   - `addProject`: rejects name `"Inbox"` (case-insensitive) with `RESERVED_NAME`
   - `updateProject`: rejects changes to `projectIndex === 0` with `PROTECTED_PROJECT`; rejects renaming to `"Inbox"` with `RESERVED_NAME`
   - `deleteProject`: rejects `projectIndex === 0` with `PROTECTED_PROJECT`
   - `reorderProject`: rejects source or destination `0` with `PROTECTED_PROJECT`

## State Management

`useTodoOperations` (`hooks/useTodoOperations.ts`) owns all state:

- **`appStateRef`** — a `useRef` holds the current `AppState` for synchronous access within callbacks (avoids stale closure issues)
- **Debounced saves** — mutations trigger a debounced write to storage, preventing excessive disk I/O
- **Undo stack** — each mutation pushes the previous state; `Ctrl+Z` pops and restores
- **External-change reload** — the active `FileSystem`'s optional `watch(path, callback)` (implemented by `TauriFileSystem`, not by `LocalStorageFileSystem`) fires when another process modifies a workspace file (a directory path is watched recursively, so a change to a project in a subfolder — or a `markdone:` marker being added to or removed from a note — is seen too); the hook also catches `ExternalChangeError` thrown from a conflicting `write()`. Either way it reloads the workspace and notifies the user rather than silently overwriting the external change.

## Testing

Tests live alongside source files as `*.test.ts(x)`, plus `components/__tests__/` and `storage/__tests__/` for some, and run with Vitest. Vitest globals (`describe`, `test`, `expect`, etc.) are available without imports — configured in `vite.config.ts`.

```bash
npm test           # single pass
npm run test:watch # watch mode
```
