<!--
Covers: graceful degradation. Every line below is deliberately malformed in
one specific way and must not crash the parser; the malformed fragment
stays in the description text (with a warning where the fragment matched
a token shape at all), and everything else on the line still parses
normally. An empty # Inbox is included explicitly so the only diffs from
the source are the ones below.
Expect: NOT byte-for-byte. Per the Normalizations table's "a description
substring that would tokenize -> backslash-escaped" row (no warning),
serializing re-escapes any fragment that still matches a token's sigil
shape and boundary, even though it failed *validation* as that token —
escaping only cares whether it would be re-scanned as an attempt, not
whether the attempt would succeed. That covers rows 1, 2, 4, 5, and 6
below. Row 3 is the one exception: an unclosed &(...) never matches the
actual-token shape at all (no closing paren), so the tokenizer never
touches it and the serializer has nothing to escape.

Line-by-line:
  1. Invalid date shape (!04-20-2026 is not YYYY-MM-DD) -> stays as text
     (warning), re-escaped to \!04-20-2026 on write
  2. Bare effort with no unit (~3) -> stays as text (warning), re-escaped
     to \~3 on write
  3. Unclosed actual token (&(2026-04-01) -> stays as text, no warning
     (never matched a token shape), NOT escaped on write
  4. Numeric-only tag (#2026) -> not a tag, stays as text per the
     at-least-one-non-digit rule, no warning, but still re-escaped to
     \#2026 on write (it did match the tag shape, just failed the
     at-least-one-non-digit check)
  5. Invalid effort unit (~2weeks, "weeks" is not a valid unit) -> stays
     as text (warning), re-escaped to \~2weeks on write
  6. More than two dates in an actual token -> stays as text (warning),
     re-escaped to \&(2026-01-01, 2026-02-01, 2026-03-01) on write
-->
# Inbox

# Edge Cases

- [ ] Reschedule the kickoff !04-20-2026 @computer
- [ ] Something that takes ~3 to finish
- [ ] Already did this &(2026-04-01
- [ ] Reference ticket #2026 in the postmortem
- [ ] Vacation planning ~2weeks @home
- [x] Triple-dated nonsense &(2026-01-01, 2026-02-01, 2026-03-01)
