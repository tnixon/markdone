# Workflow: session-start summary

Read-only. `summary` has no MCP tool — always run it through the CLI (see
"Setup check" in `SKILL.md` for how workspaces are configured):

```
markdone [--workspace <id>=<path> ...] summary
```

Add `--json` if you need to parse the output rather than just read it.

Once you have real output, present it as a session-start orientation, not a
raw dump:

1. Lead with **overdue** and **stale waiting-fors** — these are the two
   signals that indicate something needs attention now, not just eventually.
2. Name any project reported under "no open task under Next" — a kanban
   project with nothing actionable is stalled and worth flagging explicitly.
3. Give open-task counts per project as context, briefly.
4. Offer to pull next actions (`markdone_get_next_actions` MCP tool, or
   `markdone next` CLI) or dig into one project, rather than stopping after
   the summary.
