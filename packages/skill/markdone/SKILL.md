---
name: markdone
description: Read, query, and change Markdone task workspaces — Markdown GTD/PARA todo files and folders whose task lines carry !due >defer @context $value %complexity ~effort &actual #tag ^id tokens, with _markdone.md defaults and an inbox.md inbox. Use when the user mentions Markdone or asks about their todos, next actions, inbox, overdue or waiting-for tasks, a weekly review, or a session-start summary, or when working with a Markdone .md task file or vault folder — via markdone_* MCP tools or the markdone CLI.
compatibility: Requires the markdone CLI on PATH (npm install -g @markdone/toolkit). Uses the markdone MCP server when the host has it registered.
metadata:
  version: "0.1.3"
---

## Setup check

Before doing anything else, confirm the environment:

- `markdone --version` — if this fails, the `markdone` CLI isn't on `PATH`.
  Tell the user to run `npm install -g @markdone/toolkit` and stop.
- Workspaces are configured either as repeatable `--workspace <id>=<path>`
  CLI flags, or as `MARKDONE_WORKSPACES=<id>=<path>,<id>=<path>,...` (used by
  both the CLI and the MCP server when no flags are given). If neither is
  configured, **ask the user for a workspace path** rather than falling back
  to whatever `./todo.md` happens to resolve to in the current directory.

## The one rule

**Never write or edit a task line by hand when an operation exists for the
change.** Every mutation — `markdone_*` MCP tool or `markdone` CLI
subcommand — owns tokenizing, escaping, canonical token order, and the
`&`/`^id` bookkeeping for you. A hand-edited line that looks right can still
break round-trip fidelity in ways that only show up on the next parse (see
[reference/tokens.md](reference/tokens.md) — "Tokenizing rules" — for why:
boundary rules, skipped regions, and escaping are easy to get subtly wrong).

If no operation covers what you need (e.g. an unrecognized `_markdone.md`
key), say so and propose the raw edit as an explicit, previewed diff — don't
silently work around the gap by editing some *other* line by hand instead.

## Workspace modes

- **File mode** — one `.md` file is the whole workspace. Each `# H1` starts
  a project. Layout (checklist vs. kanban) is *inferred*: any H2 under a
  project makes it kanban with those H2s as columns.
- **Directory mode** — a folder is the workspace; a project is any `.md` file
  under it, **at any depth**, whose frontmatter has `markdone: 2`. An
  unmarked `.md` is an ordinary note: not a project, not parsed as tasks,
  never written — don't treat its checkboxes as tasks. This is the vault
  mode and the default assumption when a workspace path isn't obviously a
  single file. `_markdone.md` in the root holds workspace-wide defaults
  (`owner`, `layout`, `columns`, `priority`, `on-complete`, and a `projects`
  ordering list of workspace-relative paths without `.md`, e.g.
  `home-network/todo`) and is never itself a project. `inbox.md` at the root
  is the reserved inbox — by **filename**, unlike file mode where it's the
  project *named* Inbox; `inbox.md` in a subfolder is just a note. A nested
  project with no title or H1 is named after its **parent folder**
  (`home-network/todo.md` is "home-network"); address a project by its path
  when names collide. Layout is *declared* per project via frontmatter
  `layout`/`columns`, not inferred — an H2 is ordinary prose structure in a
  vault note unless the project says otherwise.

**Project folders.** A project's non-task documents (plans, notes,
attachments) sit beside its task file: keep the task file as
`<project>/todo.md` and the rest unmarked next to it. Only the marked file is
a project; Markdone never reads the unmarked notes as tasks or writes them,
and a project rename or removal touches the task file only, never the rest of
the folder. A project with no folder is a single marked `<project>.md` at the
workspace root. Identification is by the marker, never the filename.

**Workflow.** In a kanban project, `on-complete: <column>` (or `none`) in
frontmatter or `_markdone.md` names the completion column (default: the last
column). Completing or cancelling a task moves it to the top of that column,
moving a task into it completes it, and uncompleting it returns it to the top
of the first column. These rules run inside the operations, so
`complete`/`cancel`/`uncomplete`/`move` already do them — don't also move the
task by hand.

## Addressing tasks: always by `^id`

```typescript
type TaskAddress = { workspaceId: string; taskId: string };  // preferred
type TaskLocation = { workspaceId: string; projectIndex: number; columnIndex?: number; taskIndex: number };
```

Address tasks by `^id` (`TaskAddress`) whenever one exists — `taskId` is the
id *without* the caret, and it's unique per **workspace**, so `workspaceId`
is required either way. Positional `TaskLocation` is a fallback for a task
with no id yet, never a first choice: every index in it shifts when
anything above it in the same list changes, so a location computed a step
ago can silently address the wrong task now.

`add`/`add-subtask` assign an id by default. If a workspace has open tasks
with none — `markdone lint` reports these as `info` findings — run
`assign-ids` (CLI) or `markdone_assign_task_ids` (MCP) once to backfill them.

## Tokens, briefly

`! > @ $ % ~ & # ^` — due, defer, context, value, complexity, effort,
actual, tag, block-id — emitted in that order, with `^id` strictly last.
Four Obsidian-driven constraints worth knowing even though operations
enforce them: effort is `~2hrs` not `*2hrs` (`*` is emphasis); nested tags
are `#key/value` not `#key(value)` (parens aren't valid Obsidian tags); a
tag needs at least one non-digit (`#2026` is not a tag); and every literal
`$` in a description is escaped, so a task line can never carry the two
unescaped `$` characters that would open a MathJax span. Full grammar,
reserved nested tags (`#owner/ #waiting/ #energy/ #after/ #every/`), the
`&` actual-time syntax, and the normalization table are in
[reference/tokens.md](reference/tokens.md).

## Owner resolution in shared workspaces

Effective owner resolves: task's own `#owner/<name>` → project frontmatter
`owner` → workspace default (`_markdone.md` or file-mode frontmatter) →
unowned. **Write `#owner/` only when the caller actually named an owner** —
never stamp the inherited default onto a task just to make it explicit; an
elided owner is not a missing one. If a task already carries a `#owner/`
tag that happens to match the inherited default, leave it — it's redundant
but valid, and round-trip fidelity beats tidiness.

## `score`: computed, never written

`score` (CLI) / `markdone_score` (MCP) returns four independent signals,
each `undefined` when its inputs are missing, **none of them ever persisted
to a file**:

- `importance` = `$value × project priority`
- `urgency` = slack in days = `(due − today) − effort`, needs both `!` and `~`
- `risk` = mean actual/estimate ratio for tasks sharing this `%complexity`
- `fit` = `{ contexts, energy, owner }` — raw signals, not a single number

Use these to answer "what should I work on" or "how reliable are these
estimates" — never propose writing one back onto a task line.

To score many tasks, don't call `score` once per task: `markdone list --json
--score` (CLI) / `markdone_list_tasks` with `withScores: true` (MCP) returns
every matching task with its `score` object attached, from one read of the
workspaces against one date. It takes all of `list`'s filters, and the
scores are identical to what `score` returns for each task. It does not
sort or rank — combining the signals is your call.

## MCP tools vs. CLI

Same operations, two surfaces. Prefer the `markdone_*` MCP tools when the
host has the `markdone` MCP server registered — structured arguments, the
preview/confirm token contract below, and `markdone_apply_batch` for an
atomic multi-step change. Some hosts prefix tool names by server (e.g.
Hermes Agent: `mcp_markdone_markdone_add_task`) — look for the `markdone_*`
suffix, not an exact match. Use the `markdone` CLI when MCP isn't available
(a script, a hook, a shell) — and always for `summary` and `lint`, which
have no MCP tool. The full operation ↔ command ↔ tool mapping is in
[reference/interfaces.md](reference/interfaces.md).

## Shell safety

Never interpolate unvalidated user text into a shell command. When running
the CLI via a shell: pass each value (workspace path, task text, tag) as
its own quoted argument, never by string-splicing it into the command line;
if a value contains shell metacharacters (`` ` ``, `$`, `;`, `|`, `&`, `<`,
`>`, quotes, newlines), don't run the command — report the offending value
and ask for a plain path or id instead. For task text or descriptions that
come from the user, prefer an MCP tool's structured arguments over building
a CLI invocation at all.

## Preview, then confirm — always

**MCP:** call a mutating tool without `confirm` first. It returns a diff and
a `token`. Read the diff. Call again with `confirm: true` and that `token`
to apply. A token only validates a retry of that exact call; a changed
argument, or a file that changed underneath it, invalidates it and the
server hands back a fresh preview instead of erroring into nothing.

**CLI:** run the mutation with `--dry-run` first, read the printed diff,
then run it again without `--dry-run`.

**If a diff shows lines moving or changing beyond the task you targeted,
stop and report it — don't confirm anyway.** A project's description or
frontmatter block shifting position means something is wrong with the
mutation, not something to work around by applying the change regardless.

## Worked example: clarifying an inbox capture

Inbox holds `- [ ] look into the analytics thing before launch`, no `^id`.

1. `markdone_list_tasks` scoped to the inbox project to find it and read its
   assigned id (or `assign-ids` first if inbox tasks have none).
2. Decide the target: this belongs in `website-redesign`, column `Next`.
3. Choose tokens deliberately:
   - `!2026-04-05` — the launch date is a real deadline.
   - `@computer` — needs a browser and the analytics dashboard.
   - `~3hrs`, `%5` — an estimate and a rough complexity, so `score` can
     compute slack and risk later.
   - `#energy/high` — focus work, not a five-minute filler task.
   - **No `$value`.** Don't invent one — ask the user instead. `$` feeds
     `importance` directly; a guessed number silently reorders their
     priorities against tasks they actually valued on purpose.
4. One `markdone_apply_batch` (or `markdone_move_task` then
   `markdone_update_task`) so a partial failure doesn't leave the task
   half-moved: moved into place, text tightened, tokens attached.
5. Preview, read the diff, confirm with the token.

## Worked example: waiting-for and defer

A task blocked on someone else isn't done and isn't actionable — it's
waiting. Tag it `#waiting/dana`; if it also carries a `!date`, that date is
now a **follow-up** ("when do I chase this"), not a deadline. And a task
that simply isn't actionable *yet* — not blocked on anyone, just not yet
time — gets `>2026-04-01` (defer) rather than being deleted and re-created
later. Deleting loses its `^id`, any `#after/` dependents, and its history;
deferring hides it from active views without losing any of that.

## Etiquette checklist

1. Never raw-edit a task line when an operation exists for the change.
2. Always preview a mutation and read the diff before confirming it.
3. Prefer `>` defer over deleting — not-yet-actionable isn't a task to remove.
4. Never invent a `$value`. Ask — it feeds `importance` silently.
5. Always address a task by its `^id`, never by position, once one exists.

## Workflows

- [reference/workflow-summary.md](reference/workflow-summary.md) —
  session-start orientation: run `markdone summary` and present it right.
- [reference/workflow-lint.md](reference/workflow-lint.md) — run
  `markdone lint` and propose a previewed fix for each finding.

## Reference

- [reference/operations.md](reference/operations.md) — every operation's
  full parameter table, generated from the operations registry.
- [reference/tokens.md](reference/tokens.md) — complete token grammar,
  tokenizing rules, normalizations, frontmatter keys.
- [reference/interfaces.md](reference/interfaces.md) — operation ↔ CLI
  command ↔ MCP tool mapping, CLI flags/exit codes, the MCP token contract.
- [reference/TODO_FORMAT.md](reference/TODO_FORMAT.md) — the normative
  format spec (vendored into this skill), for anything not covered above.
