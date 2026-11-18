<!--
Covers: \$ escaping in description text alongside a real $value token, and
the "at most one $ token per line" rule that keeps Obsidian's inline math
from ever triggering. An empty # Inbox is included explicitly so the only
diff from the source is the one normalization below.
Expect: NOT byte-for-byte. The first task's \$5k is already escaped and
round-trips unchanged. The second task's $12/month is a bare, unescaped
dollar sign that fails the $value token's own boundary rule (not followed
by whitespace, so it was never at risk of being read back as a value) —
but the spec's "every literal dollar sign in the description is escaped"
rule (Escaping section) is unconditional, not just "when it would
tokenize", so it still gains a backslash on write. This is the "bare $ in
description text -> \$" Normalizations row (no warning).
-->
# Inbox

# Budgeting

- [ ] Negotiate the \$5k invoice down $3 %2
- [ ] Renew the $12/month subscription @online
