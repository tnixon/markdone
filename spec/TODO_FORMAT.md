# Markdone File Format Specification (v2)

Markdone stores tasks in plain Markdown. This document is the normative
specification: it defines what a conforming parser must read, what a conforming
serializer must write, and what a consumer may compute.

## Design Goals

Three forces shape v2.

**1. Obsidian is a first-class editor.** A Markdone workspace is expected to live
inside an Obsidian vault and be edited by hand as often as through the app.
Several v1 tokens fought Obsidian's renderer: `*2hrs` collides with emphasis,
`#key(value)` is not a valid Obsidian tag, and a stray `$` on a line with a
`$value` token triggers inline MathJax. v2 removes those collisions.

More importantly, an Obsidian note is *mostly prose* — paragraphs, callouts,
embeds, links, code blocks — with tasks embedded in it. A format that only
understands task lines is not safe in a vault, because anything it fails to
understand it destroys on the next save. Hence the content-preservation
requirement below.

**2. One project per note.** Vault users keep a folder of notes, not a single
monolithic file. Directory mode makes a folder the workspace and each *marked*
note a project; every other note is left alone.

**3. A GTD/PARA workflow shared between two people.** This requires ownership,
waiting-for state, defer dates, energy levels, dependencies, recurrence, and a
stable way to address an individual task.

---

## Hard Requirements

A conforming implementation must satisfy all five.

1. **Round-trip fidelity.** `parse → serialize` reproduces the input byte for
   byte, with the sole exception of the normalizations enumerated in
   [Normalizations](#normalizations-lossy-by-design). This includes blank lines,
   indentation, and interior spacing of description text.

2. **Content preservation.** Every line of a source file is either recognized
   structure (frontmatter, heading, task line) or **opaque block content**.
   Opaque content is retained verbatim, in position, and re-emitted unchanged.
   The parser never discards a line it does not understand. A conforming parser
   may not represent a document as a detached list of tasks; it must model an
   ordered sequence of blocks so that a task's position among surrounding prose
   survives a write.

3. **Canonical token order.** Metadata tokens are emitted in the canonical order
   defined below. Round-trip fidelity of token *values* is required; round-trip
   fidelity of token *order* is not.

4. **Unknown-token preservation.** Any `!`, `>`, `@`, `$`, `%`, `~`, `&`, `#`, or
   `^` sequence that does not match its expected grammar remains part of the
   description text. It is never silently dropped.

5. **Graceful degradation.** Malformed input never crashes the parser. It emits a
   warning, preserves the raw content, and continues.

---

## The Markdone Marker

A Markdone file declares itself with a frontmatter key:

```yaml
---
markdone: 2
---
```

The value is the **major version** of this specification the file follows, as a
bare integer. This revision defines `2`.

The marker serves two readers:

- A consumer that sees one note at a time — an editor plugin, an agent handed a
  single file — uses it to know the note is a Markdone file and which version
  it follows. A note without a supported marker is not a Markdone file to such
  a consumer: it must not decorate, intercept, or write it.
- Directory-mode loading uses it to decide which files are projects
  ([Directory Mode](#directory-mode)).

A consumer **must refuse to write** to a file whose marker names a major
version it does not support; it may report the file, and must not load it as a
project. A marker whose value is not a positive integer is treated the same way
(reported as unreadable, never loaded).

In file mode the workspace file is named explicitly by the user, so it loads
with or without the marker (the marker, if present, is workspace-level
frontmatter and is checked as above). A conforming linter reports a missing
one.

The marker is a property of the file itself: it is never inherited from
`_markdone.md`.

---

## Workspace Modes

A workspace is either a single file or a directory. Both use the same task
syntax; they differ in where projects and metadata live.

### File Mode

One `.md` file is the whole workspace. Each `# Heading` (H1) starts a project.
This is the v1 layout and remains supported for simple standalone lists.

```markdown
---
owner: alice
---

# Inbox

- [ ] Buy groceries !2026-04-01 @errands $3 %1

# Website Redesign

## Backlog

- [ ] Audit current analytics %3 $8
```

In file mode:

- YAML frontmatter at the top of the file is **workspace-level**.
- Projects have no frontmatter of their own and therefore **inherit workspace
  values only**. There is no per-project `status`, `area`, `owner`, or
  `priority`; the project priority weight defaults to `1` (neutral) so the
  prioritization formulas still evaluate.
- Layout is **inferred**, as in v1: a project containing any H2 is a kanban
  board, otherwise it is a checklist. This is retained for backward
  compatibility.
- `# Inbox` is the reserved first project (see [The Inbox](#the-inbox)).

Per-project metadata requires directory mode.

### Directory Mode

A folder is the workspace. A **project** is any `.md` file under the workspace
root, at any depth, whose frontmatter has a supported
[marker](#the-markdone-marker). The rule is the same at the root and in
subfolders. Directory mode is the vault mode and the primary target for v2.

```
my-workspace/
  _markdone.md          workspace defaults, never a project
  inbox.md              the reserved inbox (workspace root only)
  reading-list.md       a project (marked root file)
  notes.md              an ordinary note: no marker, not a project
  home-network/
    todo.md             a project, named "home-network"
    network-plan.md     an ordinary note: no marker, not a project
  attachments/          scanned like any folder; holds no marked file
```

In directory mode:

- **An unmarked `.md` is an ordinary note**, at the root or anywhere below it:
  never parsed as tasks, never listed as a project, never written. Its
  checkboxes are not tasks. Files that are not `.md` are ignored.
- **Two files are identified by name, at the workspace root only.**
  `_markdone.md` holds the workspace defaults, needs no marker, and is never a
  project. `inbox.md`, matched case-insensitively, is the inbox: it is created
  with the marker when missing, and an existing root `inbox.md` without the
  marker is still the inbox. Neither name has a special role in a subfolder.
  The inbox cannot be deleted or renamed; its frontmatter `title` may relabel
  it for display without changing its role.
- **Discovery does not descend into hidden folders** (names starting with `.`)
  **and does not follow symbolic links.** A consumer may also skip dependency
  folders such as `node_modules`; this implementation does.
- **A file whose marker names an unsupported major version is reported and
  skipped**, never loaded as a project.
- **Project name** resolves in order: frontmatter `title`; else the first H1 in
  the file; else, for a root file, the filename without its extension, and for
  a nested file, the name of its parent folder. A nested file never falls back
  to its own filename, so `home-network/todo.md` is "home-network", not "todo".
- **Layout is declared**, not inferred (see [Project Structure](#project-structure)).
- **Names are unique.** Two projects may not resolve to the same name
  (compared case-insensitively). A consumer loads both, reports the collision
  naming both file paths, and treats name-only addressing of either as
  ambiguous. A project can always be addressed by its **project path**: the
  workspace-relative path without the `.md` extension (`reading-list`,
  `home-network/todo`) — the same form `projects:` uses. Paths are unique by
  construction.

*Non-normative naming convention.* A project that has its own folder keeps its
task file there as `<project>/todo.md`; a project with no folder is a single
marked file at the workspace root, `<project>.md`. Identification never depends
on the name — only the marker does.

#### `_markdone.md`

A reserved note in the workspace root holds workspace-level defaults. Its
frontmatter carries the defaults; its body is free prose, serving as a README
for the workspace. **It is never treated as a project.**

```markdown
---
owner: alice
layout: checklist
columns: [Next, Later, Waiting, Done]
priority: 1
projects: [website-redesign, reading-list, home-network/todo]
---

Shared task workspace for Alice and Bob. Weekly review on Fridays.
```

Recognized keys are `owner`, `layout`, `columns`, `priority`, `on-complete`
(defaults inherited by every project), and `projects` (ordering, below).
Unknown keys are preserved.

A consumer may be configured to look for a different filename. The default is
`_markdone.md`: it is visible and editable in Obsidian — unlike a dotfile — and
the leading underscore sorts it out of the way. It is deliberately not `inbox.md`,
which is a real project and should not be overloaded, and deliberately not
application configuration, because two people share this folder and the defaults
must travel with it.

#### Project Ordering

A folder has no inherent order. The `projects` key in `_markdone.md` fixes it:

```yaml
projects: [website-redesign, reading-list, home-network/todo]
```

Entries are workspace-relative paths without the `.md` extension. Root entries
are `reading-list`; a nested project is `home-network/todo`. Listed projects
appear in the listed order; any project not listed follows, sorted by path. The
inbox is always first regardless. An entry that matches no marked file is
ignored with a warning.

This keeps reordering expressible in the format, so both people see the same
order and a reorder operation has somewhere to write its result.

---

## The Inbox

Every workspace has exactly one Inbox: the default capture point for
unprocessed tasks.

- **File mode** — the project named `Inbox` (case-insensitive). If no such
  project exists, an empty one is prepended. If it is not first, it is promoted
  to first. A kanban-layout Inbox is a parse error.
- **Directory mode** — the file `inbox.md` in the workspace root. Created
  containing only the [marker](#the-markdone-marker) if missing.

In both modes the Inbox is protected: it cannot be deleted, reordered, or
renamed, and no other project may take the name `Inbox`.

> **Compatibility note.** In v1, a kanban Inbox was silently *replaced* with an
> empty checklist, destroying its columns and tasks. Under requirement 2 this is
> no longer permitted. A kanban Inbox is reported as an error and its content is
> preserved; the consumer decides how to present it.

---

## Frontmatter

YAML frontmatter is the file-level metadata block, delimited by `---` at the
very start of the file. It is workspace-level in file mode and project-level in
directory mode. This replaces v1's rule that content before the first H1 is
ignored.

### Recognized Keys

| Key | Type | Meaning |
|---|---|---|
| `title` | string | Project display name; overrides the first H1 |
| `status` | enum | `active`, `someday`, `on-hold`, `done`, `cancelled` |
| `area` | string | PARA area of responsibility |
| `goal` | string | The outcome this project serves |
| `owner` | string | Default owner for tasks in this project |
| `due` | date | Project-level deadline |
| `type` | enum | `sprint` (time-boxed) or `standard` |
| `priority` | number | Weight used by the importance formula; default `1` |
| `review` | date | Next review date, for GTD weekly review |
| `layout` | enum | `checklist` or `kanban`; default `checklist` |
| `columns` | flow list | Kanban column names, in board order |
| `on-complete` | string | Kanban completion column, or `none`; see [Workflow](#workflow-on-complete) |
| `markdone` | integer | The [marker](#the-markdone-marker): spec major version |

`type` and `layout` are unrelated: `type` describes project semantics, `layout`
describes presentation. Both may appear together.

**Unknown keys are preserved untouched.** A vault note will carry `tags`,
`aliases`, `cssclasses`, and whatever else its owner puts there; none of it is
Markdone's business.

### Writing Frontmatter

Every recognized key is a scalar except `columns`, which is a flow list
(`[Next, Later]` on one line).

A conforming serializer preserves the frontmatter block as raw text and edits it
surgically:

1. If no recognized key changed, emit the original block **verbatim**.
2. If a recognized scalar key changed, rewrite **only that key's line**,
   appending the key at the end of the block if it was absent.
3. If an edit would have to restructure a non-scalar value — for example
   `columns` written in block form across several lines — re-dump the block and
   emit a warning.

Comments, key order, and quoting style therefore survive unless Markdone had to
touch that exact line. This is the same rule that governs task lines: only what
changed is rewritten.

Because `columns` in flow form occupies a single line, reordering a board is an
ordinary case 2 edit. Case 3 arises only when a file already uses block form.

---

## Project Structure

### Declared Layout (Directory Mode)

`layout` in frontmatter decides presentation. The default is `checklist`.

**`layout: checklist`** — every task line anywhere under the project belongs to
one flat list, regardless of what headings it sits under. H2 headings are prose
structure and are preserved as opaque content.

```markdown
---
title: Reading List
layout: checklist
---

Books to get through this year.

## Notes

Recommendations from [[Book Club]].

## Queue

- [ ] Deep Work ~6hrs #genre/productivity
- [ ] The Pragmatic Programmer ~8hrs
```

Both tasks are in one list. `## Notes` and `## Queue` are headings in the
document, not structure Markdone interprets.

**`layout: kanban`** — the `columns` key is **authoritative**. The H2 sections it
names are the board, in the order listed, including empty ones.

Any *other* H2 section that contains at least one task line becomes a named
**checklist section rendered below the board**, in document order. An H2 with no
tasks that is not named in `columns` is plain prose. No task ever silently stops
being a task.

```markdown
---
title: Website Redesign
layout: kanban
columns: [Next, Later, Waiting, Done]
---

## Later

- [ ] Competitive analysis ~4hrs %5 $6 #research

## Next

- [ ] Wireframe landing page !2026-04-05 @computer %7 $9

## Done

## Notes

- [ ] Ask Bob about the old analytics export #waiting/bob
```

This renders as a four-column board — Next, Later, Waiting, Done, in frontmatter
order, with Waiting and Done empty — followed by a checklist section titled
"Notes" holding one task.

If `layout: kanban` is set but `columns` is absent, every H2 containing at least
one task line is a column, in document order, and there are no auxiliary
sections. `columns` present under `layout: checklist` is ignored with a warning.

### Inferred Layout (File Mode)

File-mode projects have no frontmatter, so layout is inferred as in v1: a
project containing any H2 is a kanban board whose H2s are its columns in document
order; otherwise it is a checklist.

### Workflow: `on-complete`

`on-complete: <column name>` declares which column of a `layout: kanban`
project holds finished work. It is a scalar, and may also be set as a workspace
default in `_markdone.md`; a project's own value wins.

| Value | Meaning |
|---|---|
| absent | the **last** column |
| `<column name>` | that column (matched case-insensitively against `columns`) |
| `none` | no completion column; completion never moves a task |

When a completion column is in effect, an **operation** — never parsing, never
file watching — maintains this invariant:

- completing or cancelling a task moves it to the **top** of that column;
- moving a task into that column completes it;
- uncompleting a task that is in that column moves it to the top of the
  **first** column.

Cancelling follows completing: a cancelled task is a finished task and moves to
the same place (but moving a task *into* the column completes only an open
one — a cancelled task keeps its state). Uncompleting returns a task to the
first column, not to the column it came from: the file does not record where
it was before it finished.

A recurring task's completed instance moves; the new open instance takes the
completed instance's former position. Each new instance's date is computed
from the previous instance's, so a month-end clamp is not undone (a monthly
task due Jan 31 becomes Feb 28, then Mar 28). Subtasks move with their parent. A name
that is not in `columns` disables the rule (and is a lint error); it does not
fall back to the last column. The key is ignored on checklist projects.

Separately, a kanban task that leaves the first column with no `&` token
records a start date, whatever `on-complete` says.

### Recommended Columns

`## Next`, `## Later`, `## Waiting`, `## Done`. The first open task under `Next`
is the GTD next action for that project. These are a convention, not a
requirement — rename them freely.

### Project Description

Text between the frontmatter (or the H1, in file mode) and the first task or
heading is the project description. It is plain prose: it is not scanned for
task metadata, and it is preserved verbatim including its blank lines.

---

## Task Syntax

A task is a single line:

```
- [ ] Description !due >defer @context $value %complexity ~effort &actual #tag ^id
```

### Checkbox States

| Notation | State |
|---|---|
| `- [ ]` | open |
| `- [x]` | done |
| `- [-]` | cancelled |
| anything else | **other** — preserved verbatim, reported as `other` |

`[X]` is accepted and normalized to `[x]`. Any other single character between
the brackets — `[/]`, `[>]`, `[?]` and the rest of the Obsidian Tasks
convention — is preserved exactly as written and reported with its raw
character, so a vault using those markers round-trips unharmed even though
Markdone assigns them no meaning.

A cancelled task may carry an `&` token recording when it was cancelled.

### Metadata Tokens

Each is optional and may appear in any order.

| Token | Syntax | Meaning | Examples |
|---|---|---|---|
| Due date | `!YYYY-MM-DD` or `!YYYY-MM-DDTHH:MM` | When the task is due | `!2026-04-03`, `!2026-04-03T14:00` |
| Defer date | `>YYYY-MM-DD` | Start date; hidden from active views until then | `>2026-04-01` |
| Context | `@word` | Where/when the task can be done | `@home`, `@phone`, `@computer`, `@errands` |
| Value | `$number` | How valuable completing this is | `$4.6`, `$7` |
| Complexity | `%number` | Unitless difficulty estimate | `%3`, `%8` |
| Effort | `~duration` | Time estimate, unit required | `~15min`, `~2hrs`, `~0.5days` |
| Actual | `&(dates)[:duration]` | When it was done and how long it took | `&(2026-04-05):3hrs` |
| Tag | `#word` | Arbitrary label | `#fun`, `#urgent` |
| Nested tag | `#key/value` | Key-value metadata, Obsidian nested tag | `#sprint/4`, `#assignee/joe` |
| Block ID | `^id` | Stable task address; **last on the line** | `^a3f9` |

**Dates** must be well-formed `YYYY-MM-DD`, optionally with `THH:MM`. A
malformed date is not a date token; it stays in the description text with a
warning. (v1 accepted any non-space run after `!`.)

**Effort units** are exactly `min`, `hrs`, `days`, `wks`. No other spelling is
valid — `~1day`, `~1hr`, and `~2weeks` all fail and remain description text.
A bare number with no unit (`~3`) is likewise invalid.

**Multiplicity.** `@context` and `#tag` may repeat. Exactly one each of `!`, `>`,
`$`, `%`, `~`, `&`, and `^` is permitted; if duplicates appear, the last wins.

**Defer and due.** If both are present, the defer date should not fall after the
due date. A parser that sees otherwise emits a warning and keeps both values.

### Tags

Tag charset is letters, digits, `_`, `-`, and `/`. A tag **must contain at least
one non-digit**, so `#2026` is not a tag — it stays in the description text.
This matches Obsidian's rule and fixes a v1 bug where `PR #42` became a tag
named `42`.

A tag containing `/` is a nested tag, split on the **first** slash: `#a/b/c` is
key `a`, value `b/c`.

The following nested-tag keys are reserved and carry defined meaning:

| Tag | Meaning |
|---|---|
| `#owner/<name>` | Who owns the task |
| `#waiting/<who>` | Waiting-for state; see below |
| `#energy/low`, `#energy/med`, `#energy/high` | Energy required |
| `#after/<id>` | Depends on the task with block ID `<id>` |
| `#every/<rule>` | Recurrence; see below |

Every other `#key/value` is free-form metadata.

#### `#owner/<name>`

The effective owner of a task resolves in order: an explicit `#owner/` tag on the
task, else the project's frontmatter `owner`, else the workspace default from
`_markdone.md` (directory mode) or the workspace frontmatter (file mode), else
unowned.

An explicit `#owner/` tag that happens to match the inherited default is
redundant but valid, and is **preserved verbatim** — round-trip fidelity takes
precedence over tidiness. The parser reports an effective owner for every task
regardless of whether the tag is present.

Elision applies only at creation time: when an application creates a task, it
writes `#owner/` only if the caller specified an owner.

#### `#waiting/<who>`

Any `#waiting/` tag puts the task in waiting-for state. The value names who or
what is being waited on. A `!date` on a waiting task is the **follow-up date** —
when to chase it — rather than a deadline.

```markdown
- [ ] Logo concepts from designer #waiting/dana !2026-04-01
```

v1's `@waiting` context still parses and is rewritten to `#waiting/unknown` with
a warning.

#### `#every/<rule>`

Marks a task as recurring. Valid rules:

| Rule | Meaning |
|---|---|
| `daily`, `weekly`, `monthly`, `yearly` | Fixed interval |
| `<N>d`, `<N>w`, `<N>m`, `<N>y` | Every N days/weeks/months/years — `3d`, `2w` |
| A weekday name | `monday` … `sunday` |

This specification defines the **syntax**; generating the next occurrence is
consumer behavior. Only **open** tasks with `#every` are considered recurring.

The recommended behavior on completion:

> Mark the instance done with an `&` token and leave it otherwise intact — it
> keeps its `^id` and its `#every` as a historical record. Insert a **new open
> task line immediately after it**, carrying the same description and tokens, the
> next date, a **fresh `^id`**, and no `&`.

Never roll the dates of a completed task forward in place. Doing so destroys the
actuals history that the estimation-feedback loop depends on, and collides with
the one-`&`-per-task rule.

### Block IDs (`^id`)

`^id` is Obsidian's block-identifier syntax and is Markdone's stable task
address. It must be the **last** thing on the line.

Charset is letters, digits, and hyphens, 1–64 characters — the intersection of
what Obsidian accepts and what is URL-safe. Note this is a subset of the tag
charset, so any block ID can always be named inside an `#after/` tag.

**Block IDs are unique within the workspace, not merely within a file.** This is
stricter than Obsidian, which only guarantees per-file uniqueness and addresses
other files as `[[note#^id]]`. The stricter rule is forced: a tag value cannot
contain `#` or `^`, so `#after/` has no way to express a cross-file reference.
Workspace-wide uniqueness is what makes dependencies resolvable at all.

On a duplicate ID, the parser emits a warning and treats every `#after/`
reference to it as unresolved.

Block IDs are optional. A task without one simply cannot be depended upon.

### Subtasks

Indented task lines under a parent, two spaces per level. **One level only.**

```markdown
- [x] Write migration plan !2026-04-10 ~4hrs %8 $7 &(2026-04-06, 2026-04-09):5hrs
  - [x] Draft schema changes ~2hrs &(2026-04-06):2hrs
  - [x] Estimate timeline ~1hrs &(2026-04-07):30min
  - [x] Review with team lead &(2026-04-09)
```

Subtasks carry the full token vocabulary, including their own `^id`.

---

## The Actual Time Token (`&`)

`&` records when a task was actually completed and optionally how long it took,
forming a feedback loop against the `~` estimate. At least one date is required;
duration is optional.

```
&(<completion>)                           completed then, duration unknown
&(<start>, <completion>)                  date range, duration unknown
&(<completion>):<duration>                completed then, took this long
&(<start>, <completion>):<duration>       range plus actual duration
```

```
&(2026-04-13)
&(2026-04-05, 2026-04-13)
&(2026-04-13):45min
&(2026-04-05, 2026-04-13):8hrs
```

Rules:

- One `&` per task.
- At least one date. A bare `&:3hrs` is invalid.
- One date is the **completion** date; two are **start** then **completion**.
- More than two dates is invalid; the token stays in the description text.
- Duration uses the effort units: `min`, `hrs`, `days`, `wks`.
- This is **not** time tracking. It is rough actual data for calibrating
  estimates.

**Auto-population.** In checklist projects, completing a task appends
`&(today)`. In kanban projects, moving a task into the first active column
records a start date; moving it into the completion column
([`on-complete`](#workflow-on-complete), by default the final column) completes
it and appends `&(start, today)`. Duration is prompted for optionally in both
cases.

---

## Tokenizing Rules

These rules determine what is a token and what is description text.

### Boundaries

A token must be delimited on **both** sides: preceded by whitespace or the start
of the task body, and followed by whitespace or the end of the line. v1 enforced
only the leading boundary, so `#a(b)c` produced a tag plus a stranded `c`.

This is what prevents `alex@work.com` from yielding a context `@work`.

### Skipped Regions

The tokenizer does not scan inside these constructs. Their contents are
preserved verbatim as part of the description:

- `[[wikilinks]]`
- `![[embeds]]`
- inline code spans delimited by backticks

So `` Fix the `$PATH` handling in [[Deploy Notes]] $5 `` has description
`` Fix the `$PATH` handling in [[Deploy Notes]] `` and value `5`. The `$PATH`
inside the code span is not a value token, and the link text is untouched.

### Escaping

A backslash before a sigil makes it literal. `\$` in the source is a dollar sign
in the description, not the start of a value token.

A conforming serializer escapes any description substring that would otherwise
tokenize on the next parse. This is what makes requirement 1 achievable: without
it, a description containing the literal text `~2hrs` would silently become an
effort estimate on the next read.

Every Markdone sigil — `!`, `>`, `@`, `$`, `%`, `~`, `&`, `#`, `^` — is
escapable ASCII punctuation in CommonMark, so `\$` renders as `$` in Obsidian
and the escape is invisible in the rendered note.

`$` deserves specific mention. Obsidian renders `$…$` as inline math. Because a
task line carries at most one `$` token and every literal dollar sign in the
description is escaped, a task line can never present the two unescaped `$`
characters that would trigger a math span.

### Canonical Token Order

On write, tokens are emitted in this order after the description text:

```
!  >  @  $  %  ~  &  #     then ^id, strictly last
```

`^id` is last because Obsidian requires the block identifier to terminate the
block. Original token positions are not tracked; a token written mid-description
migrates to the end on the next write.

---

## Prioritization Model

The metadata supports four independent signals. **All of them are computed by
consumers. None are stored in the file.**

**Importance** = `value × project priority weight`

The `$` token scaled by the project's frontmatter `priority`. A high-value task
in a deprioritized project should not outrank a moderate task in the project
that matters this quarter. Projects without a `priority` weigh `1`.

**Urgency** = slack = `(due − today) − effort`

Not the due date alone. A task due in three days that takes two days is more
urgent than one due tomorrow that takes ten minutes. Negative slack means the
deadline is already unreachable. Tasks with no `!` or no `~` have undefined
slack and are ranked by whichever component is present.

**Risk** = complexity-bucketed estimate error

Derived from history: for tasks in the same `%` complexity bucket, compare `&`
actuals against `~` estimates. A bucket that has historically run 2× over
estimate makes new tasks in that bucket riskier to schedule tightly.

**Fit** = context, energy, owner

Whether the task can be done *now, by this person*: does `@context` match where
they are, does `#energy` match their current capacity, does the effective owner
match who is asking.

A consumer may combine these however it likes. The format's contribution is to
keep the four inputs separate and unopinionated.

---

## Estimation Feedback

`~` (estimate) and `&` (actual) form a calibration loop. Over time a consumer can
surface:

- Per-task: "Estimated 2hrs, actually took 5hrs"
- Per-project: "Tasks here average 1.8× their estimates"
- Per-person: "Your estimates have been within 20% for a month"

This is a calibration tool, not a timesheet. Recording actuals should be
effortless — auto-populated on completion — and the comparison should surface
passively.

---

## Normalizations (Lossy by Design)

These are the only permitted exceptions to round-trip fidelity. Each rewrites
input into its v2 equivalent on the first write.

| Input | Output | Warning? |
|---|---|---|
| `#key(value)` | `#key/value` | yes |
| `*2hrs` | `~2hrs` | yes |
| `@waiting` | `#waiting/unknown` | yes |
| bare `$` in description text | `\$` | no |
| a description substring that would tokenize | backslash-escaped | no |
| `[X]` | `[x]` | no |
| tokens in non-canonical order | canonical order | no |

Everything else must round-trip byte for byte. In particular, blank lines,
indentation, heading text, frontmatter formatting, and unrecognized block content
are not normalized.

---

## Conformance

The normative test suite lives in [`spec/corpus/`](spec/corpus/). Each fixture is
a Markdown input paired with an `.expected.json` describing the parse result, and
each is additionally subject to a round-trip check.

A conforming implementation must, for every fixture:

1. Produce a parse result matching its `.expected.json`.
2. Re-serialize to **byte-identical** output, except where the fixture
   deliberately exercises a row of the normalization table above.

See [`spec/corpus/README.md`](spec/corpus/README.md) for the harness contract and
the directory-fixture convention.

---

## Changes from v1

### Token changes

| v1 | v2 | Rationale |
|---|---|---|
| `*duration` | `~duration` | `*` opens emphasis in Markdown; `*2hrs ... *3hrs` renders as italics in Obsidian |
| `#key(value)` | `#key/value` | Parentheses are not valid in an Obsidian tag; `/` is Obsidian's native nested-tag separator, making key-value metadata searchable in the vault |
| `@waiting` | `#waiting/<who>` | Waiting-for is a state with a subject, not a location. `@waiting` could not say *who* |
| — | `>YYYY-MM-DD` | Defer dates are core GTD; without them, everything not-yet-actionable clutters active views |
| — | `^id` | v1 had no persistent task identity at all, which made dependencies and cross-references impossible |
| — | `#owner/`, `#energy/`, `#after/`, `#every/` | Required by the shared two-person GTD workflow |
| `[ ]` `[x]` | adds `[-]`, preserves others | Cancelled is distinct from done; foreign markers must survive a vault round-trip |

`!`, `@`, `$`, `%`, `&`, and `#` are unchanged.

### Structural changes

- **Directory mode** is new. File mode is unchanged and remains supported.
- **YAML frontmatter is recognized.** v1 discarded everything before the first
  H1; v2 parses it and preserves unknown keys.
- **Layout is declared in directory mode** via `layout`, and kanban columns are
  declared via `columns`. Inferring "any H2 means kanban" is wrong in a vault,
  where H2 is ordinary document structure.
- **Content preservation is now a hard requirement.** This is the largest change
  in the specification, and the one that makes the format vault-safe.

### Changes within v2: marker-based discovery

This revision stays v2; there is no `markdone: 3`. `on-complete` is an additive
key. **Marker-based discovery is a deliberate change to what v2 directory mode
loads.** Earlier v2 text treated every root `.md` as a project and ignored
subfolders. A consumer following this revision **does not treat an unmarked
file as a project.**

**Migration (one step):** add `markdone: 2` to the frontmatter of every project
file and to `inbox.md` *before* upgrading. Until then a directory workspace
appears to have no projects; `markdone lint` reports this and names the files.

### Corrections to the v1 document

- v1 gave `*1day` and `*1hr` as examples. Neither was ever valid: the only
  accepted units are `min`, `hrs`, `days`, `wks`. The examples were wrong, not
  the implementation.
- v1's tag grammar made `PR #42` produce a tag named `42`. The
  at-least-one-non-digit rule fixes this.
- v1's "Parser Requirements" claimed round-trip fidelity, blank-line
  preservation, exact description text, and raw-line preservation on
  degradation. None of the four held in practice. v2 states them as testable
  requirements backed by the conformance corpus.

### Required follow-on work

This section originally tracked work needed before any implementation read or
wrote v2 at all. That implementation now exists — `packages/core`'s parser
and serializer are v2, exercised by the conformance corpus below and
consumed by every other package (`@markdone/cli`, `@markdone/mcp`, the
Markdone agent skill, the Obsidian plugin, and the desktop/web app). What
remains:

- ~~The data model itself needs a block representation for opaque content, a
  tri-state checkbox, and fields for the new tokens.~~ — done:
  `packages/core/src/model/types.ts`'s `Block` (opaque/task), `Checkbox`
  (`CheckboxState` including `'other'`), and `Frontmatter` types.
- ~~`src/ai/systemPrompt.ts` teaches the assistant the v1 token list.~~ —
  done: `packages/app/src/ai/systemPrompt.ts` already documents v2's
  canonical token order and `#owner/`/`#waiting/`/`^id` addressing.
- ~~`skills/markdone-todo-management/SKILL.md`~~ — done: rewritten for v2 and
  moved to
  [`packages/skill/markdone/SKILL.md`](../packages/skill/markdone/SKILL.md)
  as part of the `markdone` agent skill.
- ~~Migration hazard: the serializer has no concept of frontmatter.~~ —
  resolved: `packages/core/src/parser/frontmatter.ts` parses and
  surgically rewrites it (see "Writing Frontmatter" above).
- `sample-personal.md`, `sample-work.md` (repo root) are still written in v1
  syntax (`*2hrs`, `#key(value)`). Not a correctness bug — the parser
  normalizes both to v2 on the next write, with a warning — just stale demo
  content that doesn't show off the current format. Low priority; migrate
  when convenient, e.g. via `markdone lint` + the CLI's `update` commands, or
  the Obsidian plugin's "Convert v1 syntax in this file to v2" command.

---

## Future Directions

Some annotations are properties of a *moment* rather than of a task: today's one
important thing, what is reachable from where you are standing right now. These
do not belong on the task line, because they change daily while the task does
not. A future revision may define an overlay mechanism — per-day or
per-context annotations stored outside the task — rather than accreting more
tokens for state that expires.
