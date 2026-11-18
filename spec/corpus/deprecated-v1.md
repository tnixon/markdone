<!--
Covers: the three deprecation-rewrite rows of the Normalizations table.
Each task below is written in valid v1 syntax and must parse successfully,
then re-serialize in its v2 form with a warning. An empty # Inbox is
included explicitly so the only diffs from the source are the three
rewrites below, not an incidental Inbox insertion.
Expect: NOT byte-for-byte. Each line changes on first write:
  #priority(critical) -> #priority/critical   (warning)
  *3hrs               -> ~3hrs                (warning)
  @waiting             -> #waiting/unknown     (warning)
-->
# Inbox

# Legacy Import

- [ ] Finalize roadmap !2026-04-10 @meetings $5 %4 *3hrs #priority(critical)
- [ ] Logo concepts from designer @waiting
