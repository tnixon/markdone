<!--
Covers: every v2 token in one place, including the new defer date (>),
block ID (^), and every reserved nested tag (#owner, #waiting, #energy,
#after, #every). Canonical token order on the fully-loaded line. An empty
# Inbox is included explicitly (rather than left for the parser to
prepend) since Inbox behavior isn't what this fixture is testing.
Expect: byte-for-byte round-trip. No normalization rows apply — every
token here is already valid v2 syntax in canonical order. Note: this
file's frontmatter is workspace-level (file mode); `layout` has no
effect there (file-mode layout is inferred per project from H2
presence) and is included only to show it round-trips harmlessly.
-->
---
owner: alice
layout: checklist
---

# Inbox

# Sprint 12

- [ ] Ship v2 parser !2026-04-20 >2026-04-10 @computer $9 %8 ~3days &(2026-04-05, 2026-04-18):9days #backend #sprint/12 ^ship-v2-parser
- [ ] Wait on design review !2026-04-12 #waiting/dana
- [ ] Deep work block @computer #energy/high
- [ ] Deploy to staging #after/ship-v2-parser
- [ ] Water the office plants #every/weekly
- [x] Retro notes from last sprint &(2026-04-01):30min #owner/bob
