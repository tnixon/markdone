# @markdone/obsidian

An Obsidian community plugin for Markdone task workspaces (format v2), built
on `@markdone/core`. It decorates tokens where you already read them, gives
you one query view across your workspaces, and a handful of workspace
commands — nothing that duplicates what the Tasks plugin already does well.
See [`TODO_FORMAT.md`](../../spec/TODO_FORMAT.md) for the file format itself.

## What counts as a Markdone note

A note is a Markdone note when its frontmatter carries the marker
`markdone: 2` (spec: "The Markdone Marker"), checked through Obsidian's
metadata cache. Everything below — chips, state styling, interaction — applies
only to such notes. An unmarked note, or one whose marker names a spec version
this plugin doesn't support, is left completely alone: not decorated, not
intercepted, not written. This holds anywhere in the vault, not only inside a
configured workspace folder. Adding or removing the marker takes effect on the
open note immediately.

Live Preview is decorated (chips) but not interactive; Reading view is where
notes become interactive.

## Install

### From a checkout, for development

```bash
npm install
npm run build:obsidian
```

This produces `packages/obsidian/main.js` (gitignored — a build artifact,
not checked in) alongside the committed `manifest.json`, `styles.css`, and
`versions.json`. Symlink or copy the whole `packages/obsidian/` folder into
`<vault>/.obsidian/plugins/markdone/`, then enable it under Settings →
Community plugins.

### Installing into vaults with the script

`scripts/install-obsidian-plugin.sh` copies `main.js`, `manifest.json`, and
`styles.css` into `<vault>/.obsidian/plugins/markdone/` for each vault given.
It never touches `data.json` (the plugin's settings), and writes each file
to a temp name before renaming it into place so Obsidian or iCloud never sees
a half-written `main.js`.

```bash
npm run install:obsidian -- ~/vaults/personal ~/vaults/work   # builds, then installs
scripts/install-obsidian-plugin.sh --dry-run ~/vaults/personal # report versions only
```

- `npm run install:obsidian` passes `--build`, so the plugin is rebuilt first.
  Running the script directly skips the build unless you pass `--build`.
- `--dry-run` builds nothing and writes nothing; it prints `old -> new`
  versions per vault. It also works as `npm run install:obsidian --dry-run`.
- With no vault arguments, vaults come from `$MARKDONE_VAULTS`, a
  colon-separated list. Colon-splitting means Windows drive paths aren't
  supported; the script targets macOS and Linux.
- Paths without a `.obsidian/` folder are skipped; if none of the given
  paths is a vault, the script exits non-zero. Unknown `-` flags are an error.

Reload in Obsidian afterwards (Settings → Community plugins → Markdone off
and on, or restart Obsidian).

### From a release

Not yet published to the community plugin directory. Until then, download a
built release (or build one yourself, above) and install it the same way.

## Configuration

Settings → Markdone:

- **Workspace folders** — each is a directory-mode Markdone workspace: an
  `inbox.md`, any number of marked project notes **at any depth** (a project
  folder holding `todo.md` is one project; an unmarked note beside it is just
  a note), and an optional `_markdone.md` for shared defaults. Create the
  folder in Obsidian first, then use **Add folder…** to pick it from the
  vault's existing folders (the vault root can't be chosen). A picked folder
  without an `inbox.md` is initialized with one (containing the marker),
  which `DirectoryWorkspaceHandle` does automatically per spec. Which notes
  are projects is decided by core's discovery — the marker alone. The plugin never
  creates the folder itself: a configured folder that later goes missing
  stays in the list, flagged "not found", and is skipped until it exists
  again. Removing a folder from the list leaves its files alone.
- **Default owner** — identifies you, for filtering and highlighting your
  own tasks in the view. Never written to a file: per spec, `#owner/` is
  written only when something explicitly names an owner, and an inherited
  default is not that.
- **Chip types** — show or hide each token's decoration independently.

## What it does

**Token chips.** `!due`, `>defer`, `@context`, `$value`, `%complexity`,
`~effort`, `&actual`, `#owner/`, and `#waiting/` render as small styled
chips, in both Live Preview and Reading view, with the underlying markdown
completely unchanged underneath — still selectable, still editable. A plain
`#tag` and every other nested tag are left entirely to Obsidian's own
handling; this plugin never touches native tag rendering. An open task past
its due date, or one whose remaining slack has already gone negative even
before the deadline, gets a visual cue on the line.

**Task state styling.** Each task item in a marked note's Reading view gets
`data-markdone-status` (`open`/`done`/`cancelled`), `data-markdone-column`,
`data-markdone-waiting`, `data-markdone-deferred` and `data-markdone-context`,
and the classes `markdone-line--done`, `--cancelled`, `--waiting` and
`--deferred` (next to the existing `--overdue` cue). Styles use Obsidian's CSS
variables, so a theme or CSS snippet can restyle any state by targeting those
attributes.

**Interactive Reading view.**

- **Check off.** Click a task's checkbox to complete it, or a done task's to
  reopen it. Obsidian's own toggle is suppressed; the plugin writes instead.
  The click is the confirmation — there is no dialog. A cancelled `[-]` task
  ignores clicks.
- **Move between columns** (kanban notes). Right-click a task (long-press on
  mobile) and choose **Move to → \<column\>**; or, on desktop, drag the task
  onto a column heading (the preview auto-scrolls near its edges). Dropping on
  a column that isn't rendered yet isn't supported — use the menu.
- **Column counts.** Each column heading shows e.g. `4 open · 2 done`,
  computed from the whole note, not just the rendered section.
- **Workflow rules apply.** Completing a task in a kanban note moves it to
  the board's `on-complete` column (default: the last), moving into that
  column completes it, and reopening it returns it to the first column — the
  same rules the CLI, MCP server and app follow, because they all run core's
  operations.

How a write is made safe: matching a rendered item to its source line by
order is fine for styling but not for writing, so every write re-reads the
note and requires the source line to still be exactly what was rendered;
otherwise nothing is written and a notice says so. The task is then
addressed by its `^id` — one is assigned in the same write if it has none.
The write itself goes through `vault.process`, which re-checks the live note
against what the change was computed from; if the note changed in between,
the plugin reloads and shows a notice instead of overwriting.

**The Markdone view.** A sidebar leaf listing open tasks across every
configured workspace, grouped by project, context, or owner. Click a task to
jump to it in its file (via its `^id` block link); check it off to complete
it. A kanban project with no open task under a `Next` column is flagged as
stalled, since that usually means nothing there is actionable right now.

**Commands:**

| Command | What it does |
|---|---|
| Insert `^id` on current task | Appends a fresh block id to the task under the cursor, if it doesn't already have one |
| Convert v1 syntax in this file to v2 | Previews the parse→serialize normalization (`*2hrs`→`~2hrs`, `#key(value)`→`#key/value`, `@waiting`→`#waiting/unknown`, canonical order) as a diff, and writes it only on confirmation |
| Run lint on workspace | The same spec-conformance checks as `markdone lint`, across every configured workspace |

## The `^id` invariant

Block ids can't be *required* by the format — the spec is explicit that a
hand-typed `- [ ] buy milk` is a perfectly valid task with no id at all. So
rather than blocking on it, this plugin establishes the invariant itself:
after every reload (on load, and after a debounced reaction to a vault
change under a configured folder), any task still missing a `^id` gets one
assigned automatically, through the same preview-and-write path every other
mutation uses. One behavior, no banner, no prompt, no setting — by the time
the view or a command runs, every task already has an address.

## Architecture, for anyone extending this

- **No second parser.** Every read and mutation goes through
  `@markdone/core` — `parseCheckboxLine`, `locateTaskLineTokens`,
  `tokenizeTaskLine`, and the operations registry. Decoration in particular
  locates tokens through the same scan the tokenizer itself uses
  (`locateTaskLineTokens`), so the two can't disagree about what is or isn't
  a token.
- **`VaultFileSystem`** (`src/vaultFileSystem.ts`) implements core's
  `FileSystem` over the `Vault` API (never `vault.adapter`), so a
  `DirectoryWorkspaceHandle` built on it works on mobile as well as desktop.
- **The write path** (`src/write.ts`) previews a mutation through core
  (which writes nothing) and applies it through Obsidian's `vault.process`
  itself — re-checking the live file against what the preview was computed
  from, and refusing to write a change whose diff is implausibly large for
  a single task. That refusal exists because of a known, since-fixed
  content-relocation defect in the serializer (see "Known issue" below); it
  stays in place afterward as cheap, permanent insurance.
- **Build target** (`build.mjs`): `format: 'cjs'`, `platform: 'browser'` —
  deliberately *not* `platform: 'node'` like this repo's other builds.
  `@markdone/core`'s only dependency, `yaml`, has a `browser` build with no
  dynamic `require()`; the Node build does have one, which would throw on
  Obsidian's mobile runtime. `obsidian`/`electron`/`@codemirror/*`/`@lezer/*`
  are marked external — never bundled — since Obsidian supplies them at
  runtime and bundling a second CodeMirror would risk breaking every other
  plugin's editor extensions sharing the same `EditorView`.

## Manual test checklist (Reading view)

jsdom can't prove these; run them in a real vault with a marked kanban note
(`markdone: 2`, `layout: kanban`, `columns: [Next, Later, Done]`).

- [ ] An unmarked note with `- [ ]` lines shows no chips and its checkboxes
      toggle the normal Obsidian way.
- [ ] Adding `markdone: 2` to that note's frontmatter makes chips and styling
      appear without reopening it; removing it makes them go away.
- [ ] A note with `markdone: 3` is left alone.
- [ ] Clicking an open task's checkbox completes it, moves it to the top of
      the completion column, and does not also toggle through Obsidian (one
      write, no double toggle).
- [ ] Clicking the checkbox in the completion column reopens it and moves it
      to the top of the first column.
- [ ] Clicking a `[-]` task changes nothing.
- [ ] A task with no `^id` gets one on its first click, in the same write.
- [ ] Edit the note in another pane after the preview rendered, then click a
      stale checkbox: a notice appears and nothing is written.
- [ ] Right-click (desktop) / long-press (mobile) a top-level task: the menu
      lists every other column; choosing one moves the task. A subtask has no
      menu.
- [ ] Drag a task onto a column heading in the same preview; with a long note,
      dragging near the top/bottom edge scrolls it.
- [ ] Each column heading shows `N open · M done`, and updates after a move.
- [ ] A task with `#waiting/…`, a future `>defer`, a past `!due`, and a done
      task each look distinct; a CSS snippet targeting
      `li[data-markdone-status="done"]` takes effect.
- [ ] A project in a subfolder (`<project>/todo.md`) appears in the Markdone
      view under its folder name, and clicking a task opens that file.
- [ ] Text selection inside a task still works (draggable items must not
      swallow it).

## Known issue

A pre-existing defect in `packages/core`'s block-realignment logic could
relocate a project's surrounding prose when mutating a task with no `^id` —
fixed as part of this change (`packages/core/src/model/accessors.ts`,
`rebuildBlocks`). `write.ts`'s size-guard (above) is the permanent backstop
against a regression of the same shape, in this plugin and in any future
core change.

## Testing

```bash
npm test
```

Vitest, `environment: 'node'` by default; a handful of DOM-touching test
files opt into `jsdom` per-file via `// @vitest-environment jsdom`. The real
`obsidian` npm package ships type declarations only — no runtime — so
`vitest.config.ts` aliases the module specifier `obsidian` to
`src/__tests__/fakeObsidian.ts`, a minimal in-memory stand-in, for tests
only; the production bundle never sees it (`build.mjs` marks `obsidian`
external).
