<!--
Covers: frontmatter surgery (raw-block preservation with surgical scalar
edits). Unknown keys (tags, aliases, cssclasses), a comment, unusual
spacing/quoting, and columns given in block-list form all coexist in one
block.
Expect: byte-for-byte round-trip AS LONG AS no recognized key is edited.
This fixture is a read-only case: it documents what must be preserved,
not a write operation. A companion note for implementers (not asserted
by this fixture alone): editing `status` here should rewrite only the
`status:` line and leave everything else — including the comment and the
block-form `columns` list — untouched, UNLESS the edit touches `columns`
itself, which is the one key whose block form forces a re-dump (see
TODO_FORMAT.md, "Writing Frontmatter", case 3). The task line is already
in canonical token order (@ before ~) since token reordering isn't what
this fixture is testing.
-->
---
markdone: 2
title:   Website Redesign
# owned by the platform team, do not reassign without asking Priya
status: active
layout: kanban
columns:
  - Next
  - Later
  - Done
tags: [project, q2]
aliases: ["Site Refresh"]
cssclasses:
  - wide-page
---

Redesign of the public marketing site for the Q2 launch.

## Next

- [ ] Wireframe hero section @computer ~2hrs

## Later

## Done
