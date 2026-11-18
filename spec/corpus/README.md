# Markdone Format Conformance Corpus

This directory is the normative test corpus for [`TODO_FORMAT.md`](../../TODO_FORMAT.md)
(v2). It exists to make the spec's hard requirements — round-trip fidelity,
content preservation, canonical token order, unknown-token preservation,
graceful degradation — checkable rather than aspirational.

## Status

**`.expected.json` files now exist for all 10 fixtures**, generated against the
real v2 parser and hand-verified line by line against TODO_FORMAT.md — not just
trusted as parser output. That review caught and fixed three real parser bugs
along the way (see "Bugs found via this corpus" below), plus a number of
fixture-authoring mistakes (non-canonical token order, and several fixtures
missing an explicit `# Inbox`, both of which silently break a byte-for-byte
round-trip claim). The round-trip test harness lives in
`packages/core/src/__tests__/corpus.test.ts`.

## Leading-comment convention

Every fixture opens with an HTML comment (`<!-- ... -->`) stating what it
covers and, for malformed/deprecated fixtures, what warnings are expected.
**This comment is fixture-authoring metadata, not part of the Markdone file
under test** — it is stripped (everything up to and including the line
containing `-->`) before the remainder is fed to the parser or compared for
round-trip fidelity, and it is not present in any `.expected.json`.

This matters because TODO_FORMAT.md requires frontmatter to be delimited by
`---` "at the very start of the file": a fixture whose frontmatter block
follows the leading comment would never have that frontmatter recognized at
all if the comment weren't stripped first — silently defeating the fixture's
own point in most of the fixtures below, which rely on frontmatter (title,
layout, columns, owner, ...) actually being recognized.

## Harness Contract

For every fixture in this directory, a conformance run does the following
(after stripping the leading comment, per above):

1. **Parse.** Feed the fixture (a single `.md` file, or a `directory-mode/`
   folder) to the parser. Assert the result matches `<fixture>.expected.json`.
2. **Round-trip.** Serialize the parsed result and assert it matches
   `expectedSerialized` in `<fixture>.expected.json` — byte-identical to the
   (comment-stripped) input *except* where the fixture deliberately exercises
   a row of the Normalizations table in TODO_FORMAT.md, in which case
   `expectedSerialized` holds the fixture's stated normalized output instead.

A fixture that is not about normalization must round-trip byte-for-byte. A
fixture that is about normalization must say so in its leading comment and name
which table row it exercises. Note that canonical token reordering (spec:
"Canonical Token Order") is itself a Normalizations-table row ("tokens in
non-canonical order -> canonical order", no warning) — every fixture here
happens to already use canonical order, specifically so that property doesn't
also need exercising alongside whatever each fixture actually targets.

## Fixture-File Convention

- A single-file fixture is one `.md` file plus one sibling
  `<name>.expected.json` holding `{ file | project, warnings, expectedSerialized }`
  (`file` for a file-mode fixture parsed with `parse()`, `project` for a
  directory-mode-style fixture with no `# Project` H1s, parsed with
  `parseProject()`).
- A directory-mode fixture is a folder (e.g. `directory-mode/`,
  `directory-mode-nested/`) representing a whole workspace, plus one
  `<folder>.expected.json` at this level describing what core's directory
  loader finds in it as a unit: `defaultsFrontmatter` (`_markdone.md`'s parsed
  frontmatter), `order` (project ids — workspace-relative paths without
  `.md` — in final display order, inbox first), `projects` (keyed by the same
  ids, each carrying its `sourcePath`), `warnings`, `skipped` (marked files
  with an unsupported version) and `unmarkedNotes` (ordinary notes). Project
  files carry the `markdone: 2` marker; `_markdone.md` needs none. The
  harness drives the real loader — discovery is not re-implemented in tests.
- Every fixture opens with an HTML comment (`<!-- ... -->`) stating what it
  covers and, for malformed/deprecated fixtures, what warnings are expected —
  see "Leading-comment convention" above for why it's stripped rather than
  parsed as real content.

## Bugs found via this corpus

Building the harness against the real parser (rather than trusting its output)
surfaced three genuine parser bugs, all fixed in `packages/core`:

1. **`$` wasn't escaped unless it would fully re-tokenize.** Spec ("Escaping")
   requires *every* literal `$` in description text to be escaped, unconditionally
   — not just one that would satisfy a value token's own boundary rule. Fixed
   in `parser/tokenize.ts`'s `escapeDescription` (see `dollar-escaping.md`).
2. **A declared-kanban H2 with no tasks was misclassified as `auxiliary`
   instead of `opaque`.** Only the `task-bearing-only` inference mode checked
   for an actual task line before classifying a non-column H2; `declared` mode
   didn't. Fixed in `parser/body.ts`'s `splitKanbanBody` (see `obsidian-note.md`'s
   `## Notes` section, which has prose/a callout/a code block but no tasks).
3. **A directory-mode project's first-H1-derived name silently dropped that H1
   from the body on every write**, even with zero edits — a round-trip
   violation for any file with no frontmatter `title`. Fixed in
   `parser/parse.ts`'s `parseProject` to keep reading the H1 for the name
   without removing it from the body (see `directory-mode/reading-list.md`).

## Fixtures

| Fixture | Covers |
|---|---|
| `file-mode.md` | v1-style multi-project single file, H2-inferred kanban |
| `directory-mode/` | A folder workspace: `_markdone.md`, `inbox.md`, a declared-kanban project, a declared-checklist project |
| `directory-mode-nested/` | Marker-based discovery: a marked root project, a marked nested `home-network/todo.md` (named from its folder), unmarked notes (one full of plain checkboxes), an `inbox.md` in a subfolder (ordinary note), an unsupported-version marker (skipped), a hidden folder (not descended into), `projects:` with a nested path, workspace-default `on-complete` |
| `all-tokens.md` | Every v2 token, including `>`, `^id`, and all reserved nested tags |
| `dollar-escaping.md` | `\$` in description text alongside a real `$value` token |
| `wikilinks.md` | `[[links]]`, `![[embeds]]`, and inline code spans inside descriptions |
| `malformed.md` | Invalid dates, bare `~3`, unclosed `&(`, numeric-only tags — all degrade gracefully |
| `subtasks.md` | One-level nesting with tokens on both parent and subtasks |
| `frontmatter-unknown-keys.md` | Unknown keys, comments, quoting, and a block-form list surviving frontmatter surgery |
| `deprecated-v1.md` | `#key(value)`, `*2hrs`, `@waiting` — each exercising a Normalizations table row |
| `obsidian-note.md` | A realistic vault note: frontmatter, prose, a `## Notes` section with a callout and a wikilink, a `## Next` column with tasks, a fenced code block. Must round-trip byte-for-byte and parse to exactly the tasks under `## Next`. |

Every token in the v2 table and every row of the Normalizations table appears
in at least one fixture above.
