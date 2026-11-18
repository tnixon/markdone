<!--
Covers: a directory-mode project with DECLARED kanban layout and an
authoritative columns: list. An extra H2 (## Notes) that is not in
columns: but contains a task becomes an auxiliary checklist section
rendered below the board, per TODO_FORMAT.md's "Project Structure" ->
declared kanban rules. This is the same structural case as
obsidian-note.md but scoped to directory mode specifically.
Expect: byte-for-byte round-trip. The board is Next, Later, Waiting,
Done in that order (Waiting and Done empty); "Notes" is a checklist
section below the board holding one task. Both task lines are already in
canonical token order (! @ $ % ~ & #) since token reordering isn't what
this fixture is testing.
-->
---
markdone: 2
title: Website Redesign
layout: kanban
columns: [Next, Later, Waiting, Done]
priority: 3
status: active
review: 2026-04-24
---

Overhaul of the public marketing site ahead of the Q2 launch.

## Later

- [ ] Competitive analysis $6 %5 ~4hrs #research

## Next

- [ ] Wireframe landing page !2026-04-05 @computer $9 %7 #owner/bob

## Waiting

## Done

## Notes

- [ ] Ask Bob about the old analytics export #waiting/bob
