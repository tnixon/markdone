<!--
Covers: the realistic-vault-note case that motivated content preservation
as a hard requirement in the first place. This note mixes frontmatter, a
plain paragraph, a ## Notes section containing an Obsidian callout and a
wikilink, a declared ## Next kanban column with real tasks, and a fenced
code block — the mundane shape of an actual Obsidian project note.
Expect: byte-for-byte round-trip of the ENTIRE file, and a parse result
whose task list is EXACTLY the two tasks under ## Next — nothing from
## Notes (prose, callout, wikilink, code block) is parsed as a task or
as project metadata, and none of it is discarded either. ## Notes itself
has no task lines, so it must classify as plain prose (opaque), not an
auxiliary checklist section, even though it isn't a declared column.
Both task lines below are already in canonical token order (! @ $ % ~ &
# ^id) since token reordering isn't what this fixture is testing.
-->
---
markdone: 2
title: Kitchen Renovation
layout: kanban
columns: [Next, Later, Done]
owner: alice
---

Tracking the kitchen remodel end to end. See the contractor's quote at
[[Contractor Quote - April]].

## Notes

> [!warning] Permit deadline
> The city permit expires 2026-06-01. Do not schedule demo after that
> without a renewal.

Countertop options discussed with [[Bob]]:

```
quartz:  $4200, 3wk lead time
granite: $3800, 5wk lead time
```

## Next

- [ ] Confirm countertop material with Bob !2026-04-20 @home $8 %3
- [ ] Schedule demo crew @home ~1days #waiting/contractor

## Later

## Done
