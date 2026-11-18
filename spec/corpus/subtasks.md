<!--
Covers: one-level subtask nesting (2-space indent), with the full token
vocabulary on both parent and child lines, including independent ^id
block identifiers on each. An empty # Inbox is included explicitly since
Inbox behavior isn't what this fixture is testing.
Expect: byte-for-byte round-trip. Every task line below is already in
canonical token order (! @ $ % ~ & # then ^id), since token reordering
isn't what this fixture is testing either.
-->
# Inbox

# Home Renovation

- [x] Kitchen remodel !2026-05-01 $10 %9 ~3wks &(2026-03-01, 2026-04-28):8wks ^kitchen-remodel
  - [x] Demo old cabinets ~2days &(2026-03-01, 2026-03-03):2days ^demo-cabinets
  - [x] Install new counters @home ~1wks &(2026-03-20, 2026-03-25):1wks #after/demo-cabinets
  - [ ] Final walkthrough with contractor @home #waiting/contractor
