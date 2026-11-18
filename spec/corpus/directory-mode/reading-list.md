<!--
Covers: a directory-mode project with no explicit title (falls back to
the first H1) and DECLARED checklist layout, where an H2 (## Notes) is
plain prose structure rather than a column, per TODO_FORMAT.md's
"Project Structure" -> declared checklist rules. Also exercises
frontmatter status/area/goal and inherits owner/priority from
_markdone.md (no local owner or priority key here).
Expect: byte-for-byte round-trip. Both tasks belong to one flat list
regardless of the ## Notes / ## Queue headings above them.
-->
---
markdone: 2
status: someday
area: Personal Development
layout: checklist
---

# Reading List

## Notes

Recommendations from [[Book Club]].

## Queue

- [ ] Deep Work ~6hrs #genre/productivity
- [ ] The Pragmatic Programmer ~8hrs
