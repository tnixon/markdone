<!--
Covers: the tokenizer's skipped regions — [[wikilinks]], ![[embeds]], and
inline code spans — none of which should be scanned for sigils even
though they contain characters (#, $, *, /) that look like tokens. An
empty # Inbox is included explicitly since Inbox behavior isn't what
this fixture is testing.
Expect: byte-for-byte round-trip. Description text keeps the link/embed/
code-span content verbatim; none of it is extracted as metadata.
-->
# Inbox

# Research

- [ ] Read [[Deep Work]] before the retro ~2hrs
- [ ] Compare against ![[old-analytics-export.png]] #research
- [ ] Fix the `$PATH` handling described in [[Deploy Notes#Environment]] $5 %3
- [ ] Note that `*emphasis*` inside code is not an effort token
