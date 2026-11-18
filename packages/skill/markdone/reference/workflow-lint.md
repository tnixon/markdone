# Workflow: lint and propose fixes

`lint` has no MCP tool — always run it through the CLI:

```
markdone [--workspace <id>=<path> ...] lint
```

It exits non-zero on any blocking finding — that's the expected case, not a
failure of this workflow, so don't treat a non-zero exit as an error here.

For each finding, propose a fix — as a **previewed mutation**, never applied
without the user confirming the diff (see "Preview, then confirm" in
`SKILL.md`):

| Finding | Severity | What to propose |
|---|---|---|
| Open task with no `^id` | info | `markdone_assign_task_ids` without `confirm` (or `markdone assign-ids --dry-run`) on that workspace, show the diff, ask before applying |
| Deprecated v1 syntax (`*2hrs`, `#key(value)`, `@waiting`) | info/warn | The parser normalizes this automatically the next time that file is written — the cleanest fix is a no-op preview: touch the affected task with `markdone_update_task` (or `update`), even a whitespace-preserving no-op change, and show the resulting diff before confirming |
| Duplicate `^id` | error | No single operation resolves this. Report which tasks collide and ask which one keeps the id — reassigning one requires a targeted `update` you propose explicitly, not something to guess |
| `#after/<id>` referencing an unknown id | error | Ask whether the dependency target was renamed, removed, or mistyped, before proposing any change |
| Invalid or unrecognized `_markdone.md` key | error/info | No operation covers workspace-defaults frontmatter — propose the exact line edit as a diff and confirm before writing |
| Unmarked root `inbox.md` | warn | Add `markdone: 2` — the finding carries the exact edit (`fix`) to show as a diff and confirm |
| Unmarked `.md` that looks like a task file | info | Ask whether it is meant to be a project; if so propose the finding's add-marker `fix`. Never mark a note the user didn't confirm — an unmarked note is an ordinary note |
| Workspace with `.md` files and no marked project | warn | A workspace from before marker discovery: the migration is adding `markdone: 2` to every project file and `inbox.md`; list the candidate files and confirm before editing any |
| Marker naming an unsupported version | error | Report only. Never edit or write to that file |
| Two projects with the same name | error | Report both paths; ask which to rename. Address either by path meanwhile |
| `projects:` entry matching no marked file | warn | Ask whether the file was renamed, unmarked, or moved; propose the exact `_markdone.md` line edit |
| `on-complete` naming a column not in `columns` | error | Ask which column was meant; propose the exact frontmatter edit |
| Completed/cancelled task outside the on-complete column | info | The finding carries a `moveTask` `proposal`: preview it, show the diff, confirm |

Standing rule, restated because `lint` output is exactly where it matters
most: **if a proposed preview shows lines moving or changing beyond the
task you targeted, stop and report it rather than confirming.** A
project's description or frontmatter shifting position in a diff is a sign
something is wrong with the mutation, not something to work around by
applying anyway.
