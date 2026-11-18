# Token Reference (Format v2)

Full grammar and edge cases. The skill body covers what an agent needs to
recognize; this file covers everything needed to explain or debug a task
line. Normative source: [`TODO_FORMAT.md`](TODO_FORMAT.md) (vendored into
this skill so it's available without the rest of the Markdone monorepo).

You should never need to hand-write any of this — every token here is set by
an operation parameter, not by string-building a task line yourself. This
file exists so you can read an existing line correctly and explain what an
operation call will produce.

## Checkbox states

| Notation | State |
|---|---|
| `- [ ]` | open |
| `- [x]` (or `[X]`, normalized) | done |
| `- [-]` | cancelled |
| anything else (`[/]`, `[>]`, `[?]`, ...) | `other` — preserved verbatim, not a Markdone state |

## Metadata tokens

| Token | Syntax | Meaning | Repeats? |
|---|---|---|---|
| Due date | `!YYYY-MM-DD` or `!YYYY-MM-DDTHH:MM` | Deadline (or follow-up date, on a `#waiting/` task) | No |
| Defer date | `>YYYY-MM-DD` | Hidden from active views until this date | No |
| Context | `@word` | Where/when it can be done (`@home`, `@computer`, `@errands`) | Yes |
| Value | `$number` | Feeds `importance` | No |
| Complexity | `%number` | Feeds `risk` bucketing | No |
| Effort | `~duration` | Estimate; unit required: `min`, `hrs`, `days`, `wks` | No |
| Actual | `&(dates)[:duration]` | When done, how long it took | No |
| Tag | `#word` or `#key/value` | Label or nested key-value | Yes |
| Block ID | `^id` | Stable address, **must be last on the line** | No |

**Effort units are exactly** `min`, `hrs`, `days`, `wks` — no other spelling
(`1day`, `1hr`, `2weeks` are all invalid and stay in the description text as
plain words). A bare number with no unit (`~3`) is likewise invalid.

**Dates** must be well-formed `YYYY-MM-DD`, optionally `THH:MM`. A malformed
date is not a date token — it stays in the description text with a warning.

**Multiplicity.** `@context` and `#tag` may repeat. Every other token is
singular; if duplicates appear in a file, the last one wins.

## Canonical write order

```
!  >  @  $  %  ~  &  #     then ^id, strictly last
```

An operation always emits this order regardless of what order tokens
appeared in on read. `^id` is last because Obsidian requires the block
identifier to terminate the block.

## Tags

Charset: letters, digits, `_`, `-`, `/`. A tag must contain **at least one
non-digit** — `#2026` is not a tag (this is what stops `PR #42` from
becoming tag `42`). A tag containing `/` is a nested tag, split on the
**first** slash: `#a/b/c` is key `a`, value `b/c`.

### Reserved nested-tag keys

| Tag | Meaning |
|---|---|
| `#owner/<name>` | Who owns the task — see "Owner resolution" in SKILL.md |
| `#waiting/<who>` | Waiting-for state; the task's `!date`, if any, becomes a follow-up date, not a deadline |
| `#energy/low`, `#energy/med`, `#energy/high` | Energy required (feeds `fit`) |
| `#after/<id>` | Depends on the task with block ID `<id>` |
| `#every/<rule>` | Recurrence — see below |

Every other `#key/value` is free-form and passes through untouched.

### `#every/<rule>` recurrence

| Rule | Meaning |
|---|---|
| `daily`, `weekly`, `monthly`, `yearly` | Fixed interval |
| `<N>d`, `<N>w`, `<N>m`, `<N>y` | Every N days/weeks/months/years |
| A weekday name | `monday` … `sunday` |

Only **open** tasks with `#every` are recurring. On completion: mark the
instance done with `&`, leave its `^id` and `#every` intact as history, and
insert a **new** open task line after it with a fresh `^id`, the next date,
and no `&`. Never roll a completed task's own dates forward in place.

## The `&` actual-time token

```
&(<completion>)                       completed then, duration unknown
&(<start>, <completion>)              date range, duration unknown
&(<completion>):<duration>            completed then, took this long
&(<start>, <completion>):<duration>   range plus actual duration
```

One `&` per task, at least one date (a bare `&:3hrs` is invalid), at most
two dates. Duration uses the same effort units as `~`. This is calibration
data, not a timesheet — it exists to compare against `~` estimates.

**Auto-population**, when it applies: completing a task in a checklist
project appends `&(today)`; in a kanban project, entering the first active
column records a start date, entering the final column appends
`&(start, today)`. Duration is always optional.

## Tokenizing rules (why hand-editing is unsafe)

- **Boundaries.** A token must be preceded by whitespace or line-start and
  followed by whitespace or line-end — `alex@work.com` is not a context.
- **Skipped regions.** `[[wikilinks]]`, `![[embeds]]`, and inline code spans
  are never scanned for tokens; their contents are always description text.
- **Escaping.** `\$`, `\!`, `\#`, etc. are literal in the description. Every
  sigil (`! > @ $ % ~ & # ^`) is escapable ASCII punctuation in CommonMark,
  so the escape renders invisibly in Obsidian. A conforming write escapes
  any description substring that would otherwise re-tokenize on the next
  parse — this is the whole reason hand-editing a description is risky:
  getting escaping right by hand, for every sigil, every time, is exactly
  the bookkeeping an operation exists to do for you.
- `$` gets special mention: a task line carries at most one `$` token and
  every literal `$` in the description is escaped, so a line can never
  present two unescaped `$` characters — which is what would trigger
  Obsidian's inline-math rendering.

## Frontmatter keys

| Key | Type | Meaning |
|---|---|---|
| `title` | string | Project display name; overrides the first H1 |
| `status` | enum | `active`, `someday`, `on-hold`, `done`, `cancelled` |
| `area` | string | PARA area of responsibility |
| `goal` | string | The outcome this project serves |
| `owner` | string | Default owner for tasks in this project |
| `due` | date | Project-level deadline |
| `type` | enum | `sprint` or `standard` |
| `priority` | number | Weight for the importance formula; default `1` |
| `review` | date | Next GTD weekly-review date |
| `layout` | enum | `checklist` or `kanban`; default `checklist` |
| `columns` | flow list | Kanban column names, in board order |

Unknown keys are preserved untouched — a vault note's `tags`, `aliases`,
`cssclasses`, etc. are not Markdone's business.

`_markdone.md` (directory mode only) recognizes `owner`, `layout`,
`columns`, `priority` as workspace-wide defaults, plus `projects` (an
explicit ordering list — filenames without `.md`; the inbox is always first
regardless).

## Normalizations (the only permitted round-trip exceptions)

| Input | Output | Warning? |
|---|---|---|
| `#key(value)` | `#key/value` | yes |
| `*2hrs` | `~2hrs` | yes |
| `@waiting` | `#waiting/unknown` | yes |
| bare `$` in description text | `\$` | no |
| a description substring that would tokenize | backslash-escaped | no |
| `[X]` | `[x]` | no |
| tokens in non-canonical order | canonical order | no |

Everything else round-trips byte-for-byte: blank lines, indentation, heading
text, frontmatter formatting, and any content the parser doesn't recognize
as structure.

## Subtasks

One level of indentation only, two spaces per level. Subtasks carry the
full token vocabulary including their own `^id`, addressed with
`SubtaskLocation`/subtask operations, not by re-parsing the parent's text.
