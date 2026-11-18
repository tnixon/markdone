# Changelog

All notable changes to Markdone. The Markdown format spec stays at v2 throughout.

## Unreleased

### Added

- **MIT license**, with `license` set in every package manifest and LICENSE
  included in the `@markdone/toolkit` tarball.
- **Community files:** `CONTRIBUTING.md`, `SECURITY.md`, and issue and pull
  request templates.

## 0.1.3

### Fixed

- **`update --text` and `update-subtask --text` did nothing.** The flag was
  accepted but the new text was never applied, and the command reported no
  error (#41, fixed in #42).

### Added

- **Release assets.** Publishing a GitHub release now builds
  `@markdone/toolkit` in CI and attaches `markdone-toolkit-<version>.tgz` and
  a `SHA256SUMS` file to it, so consumers no longer need a hand-packed
  tarball. A manual `Release assets` run with a tag backfills an existing
  release. See "Release assets" in the README (#43).

## 0.1.2

### Fixed

- **CLI output truncated on pipes.** With `--json`, output larger than 64 KB
  read through a pipe (always from Python's `subprocess`, intermittently with
  `| wc -c`) was cut off at 65536 bytes. `main()` called `process.exit()` as
  soon as the command finished, and on macOS a write to a pipe is
  asynchronous, so anything still buffered was discarded. It now sets
  `process.exitCode` and lets Node exit once stdout and stderr have drained.
  Output written to a file was never affected.
- **"Today" was the UTC date, not the local one.** Between local midnight and
  the UTC offset (00:00–02:00 in Vienna in summer) it was yesterday. This
  affected `done`'s `&(date)` completion stamp, recurrence and defer bases,
  `summary`'s as-of cutoff (and so its overdue and due-this-week counts), the
  "deferred, now active" check, and `score`'s urgency slack. Today is now the
  local calendar date, taken once from the clock the CLI and MCP server
  already inject, and passed through the operations that need it
  (`OperationContext` in `@markdone/core`). Callers that pass no context get
  the local date too. The `YYYY-MM-DD` format is unchanged. The Obsidian
  plugin and the app now agree: the plugin's overdue and slack cues, and the
  app's date picker ("today", "tomorrow", "in N days", calendar clicks), its
  "due this week" filter and its AI context's overdue counts, all use the
  local date as well. East of UTC the app's date picker and "due this week"
  filter had been a day early all day, not only just after midnight.

### Added

- **`list --score`: score many tasks in one call.** Each row gets a `score`
  object (`importance`, `urgency`, `risk`, `fit` — the same shape
  `score --task` returns), computed in one pass from one read of the
  workspaces against one `today`. Every existing `list` filter and
  `--workspace`/`--in` applies unchanged, and rows without `--score` are
  unchanged. Scores are returned, not sorted or combined: ranking stays with
  the caller. In the MCP server this is the `withScores` option on
  `markdone_list_tasks`. `score --task` now runs on the same code path, so the
  two cannot disagree.
