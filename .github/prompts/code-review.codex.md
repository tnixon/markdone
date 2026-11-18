
---

# Reviewer-specific instructions: Codex

## Tools

You have git and the checkout only. You have no network and no `gh`. Never run code or scripts from the checkout.

## Output

Your final message must be a single JSON object that matches the output schema, and nothing else. Do not wrap it in a code fence.

- `findings`: most severe first. Each has a `title` (imperative, at most 80 characters), a `body` (one short paragraph: the scenario that triggers it, then why it is wrong; at most 3 lines of code, in backticks), a `priority` (0 to 3), a `confidence` (0 to 1), a `path` and the shortest `line_start` to `line_end` that shows the problem and overlaps the diff, and a `rule` (the repository rule you cite as `path:line`, or null).
- `areas_clean`: the sections of "Checks by path" you applied and found nothing in.
- `overall_correctness`: "patch is correct" or "patch is incorrect", as defined under "Reporting". `overall_explanation` is one to three sentences.

A separate job posts your JSON as a comment. You do not post anything yourself.
