<!--
Covers: file mode (single .md file, multiple # Project H1s), workspace-level
frontmatter, the reserved Inbox promoted to first position, and inferred
layout — a project is kanban iff it contains any H2, otherwise checklist.
This is the v1-compatible path and must remain readable unchanged.
Expect: NOT byte-for-byte — the source deliberately puts Inbox second so the
promotion-to-first rule has something to do; the expected output moves the
"# Inbox" section (and only that section) to the top, verbatim otherwise.
No normalization rows apply; every task line below is already in canonical
token order (! @ $ % ~ & #), since token reordering isn't what this fixture
is testing.
-->
---
owner: alice
---

# Errands

- [ ] Buy groceries !2026-04-01 @errands $3 %1
- [x] Reply to Jan's email @computer &(2026-03-30)

# Inbox

- [ ] Unsorted thought from the shower

# Website Redesign

Project to overhaul the marketing site.

## Backlog

- [ ] Audit current analytics $8 %3
- [ ] Competitive analysis $6 %5 ~4hrs #research

## In Progress

- [ ] Wireframe new landing page !2026-04-05 @computer $9 %7
  - [ ] Desktop layout
  - [ ] Mobile layout
- [ ] Draft copy for hero section @computer $5 %2 ~2hrs

## Done

- [x] Choose color palette #design
- [x] Select typography
