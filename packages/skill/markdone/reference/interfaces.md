# Operation ↔ CLI ↔ MCP Reference

Every row is the same operation, reached three ways. Full parameter shapes
for each operation are in [`operations.md`](operations.md) (generated from
the operations registry, not hand-maintained — trust it over this table for
parameter details).

| Operation | CLI command | MCP tool |
|---|---|---|
| `addTask` | `add` | `markdone_add_task` |
| `updateTask` | `update` | `markdone_update_task` |
| `deleteTask` | `rm` | `markdone_delete_task` |
| `completeTask` | `done` | `markdone_complete_task` |
| `uncompleteTask` | `undone` | `markdone_uncomplete_task` |
| `moveTask` | `move` | `markdone_move_task` |
| `reorderTask` | `reorder` | `markdone_reorder_task` |
| `addSubtask` | `add-subtask` | `markdone_add_subtask` |
| `updateSubtask` | `update-subtask` | `markdone_update_subtask` |
| `deleteSubtask` | `rm-subtask` | `markdone_delete_subtask` |
| `assignTaskIds` | `assign-ids` | `markdone_assign_task_ids` |
| `addProject` | `project-add` | `markdone_add_project` |
| `updateProject` | `project-update` | `markdone_update_project` |
| `deleteProject` | `project-rm` | `markdone_delete_project` |
| `reorderProject` | `project-reorder` | `markdone_reorder_project` |
| `addColumn` | `column-add` | `markdone_add_column` |
| `renameColumn` | `column-rename` | `markdone_rename_column` |
| `deleteColumn` | `column-rm` | `markdone_delete_column` |
| `reorderColumn` | `column-reorder` | `markdone_reorder_column` |
| `getOverdueTasks` | `overdue` | `markdone_get_overdue_tasks` |
| `getTasksDueInRange` | `due` | `markdone_get_tasks_due_in_range` |
| `getTasksByContext` | `context` | `markdone_get_tasks_by_context` |
| `getTasksByTag` | `tag` | `markdone_get_tasks_by_tag` |
| `getNextActions` | `next` | `markdone_get_next_actions` |
| `getEstimationAccuracy` | `accuracy` | `markdone_get_estimation_accuracy` |
| `searchTasks` | `search` | `markdone_search_tasks` |
| `listTasks` | `list` | `markdone_list_tasks` |
| `getWaitingFor` | `waiting` | `markdone_get_waiting_for` |
| `score` | `score` | `markdone_score` |
| `applyBatch` | *(none — MCP/API only)* | `markdone_apply_batch` |

`applyBatch` has no CLI command by design: it exists to run several
operations atomically from a single agent call, which the CLI's one-command-
per-invocation shape has no use for.

## Addressing a task

Every task-scoped operation takes a `TaskRef`:

```typescript
type TaskAddress = { workspaceId: string; taskId: string };   // preferred — the ^id, no caret
type TaskLocation = { workspaceId: string; projectIndex: number; columnIndex?: number; taskIndex: number };
type TaskRef = TaskLocation | TaskAddress;
```

CLI: `--task <^id>` builds a `TaskAddress`; `--project <name|index> --index <n>`
builds a `TaskLocation`. Both need a workspace, resolved from `--workspace`/
`--in` the same way for either form.

## CLI

Global flags: `--workspace <path>` / `--workspace <id>=<path>` (repeatable),
`--json`, `--owner <name>` (default owner for `add`/`add-subtask`, and a
`list` filter), `--in <id>` (picks which loaded workspace a mutation or
project-scoped query targets), `--help`/`-h`, `--version`. Every mutation
takes `--dry-run`.

Exit codes: `0` success · `1` usage error · `2` workspace/operation error ·
`3` blocking `lint` findings.

`markdone list --score` (MCP: `markdone_list_tasks` with `withScores: true`)
attaches each row's `score` — the same object `score` returns — computed in
one pass from one read of the workspaces. Prefer it to calling `score` once
per task.

`markdone summary [--waiting-days N] [--as-of DATE]` and `markdone lint
[--strict]` have no operation-registry equivalent and no MCP tool — they're
CLI-only conveniences layered on the query operations above.

## MCP

Every tool takes `workspace` (which configured workspace id to use) plus the
operation's own parameters. Required on a mutation; optional on a query — if
omitted, the query spans **every** configured workspace, so an agent that
forgets it does not get an error, it gets data back from everything
configured on the server.

Mutating tools never write on a bare call:

1. Call without `confirm` → server returns a diff and a `token` (a hash of
   workspace + operation + arguments + the exact current file content).
   Nothing is written.
2. Call again with `confirm: true` and that `token` → server reloads the
   files, recomputes the hash, and either applies (hash matches) or returns
   a fresh preview and a new token (hash mismatch — something else changed
   the file since step 1). A token only ever validates a retry of the exact
   same call; a changed argument produces a different hash and is rejected
   the same way a concurrent edit is.

`markdone_apply_batch` uses the identical contract for a whole sequence at
once — one preview, one diff, one token, applied atomically (a failing step
rolls back every step).
