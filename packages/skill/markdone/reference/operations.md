# Markdone Operations Reference

This document describes all operations available in the Markdone operations layer.
All mutating operations return `Result<AppState>`. Query operations return data directly.

## Task Operations

### `addTask`

Add a new task to a project. For kanban projects, specify columnIndex to target a column (defaults to the first column). The task is appended to the end of the list.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `workspaceId` | string | Yes | ID of the target workspace |
| `projectIndex` | integer | Yes | Zero-based index of the target project |
| `columnIndex` | integer | No | Column index for kanban projects (optional, defaults to 0) |
| `task` | object | Yes |  |
| `assignId` | boolean | No | Assign the new task a stable ^id (default true) so it can be addressed by id afterward |

### `updateTask`

Update one or more fields of an existing task. Only the provided fields are changed; all others remain unchanged.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `location` | object | Yes | Either a positional TaskLocation, or a stable TaskAddress (workspaceId + taskId) |
| `changes` | object | Yes |  |

### `deleteTask`

Delete a task and all its subtasks permanently.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `location` | object | Yes | Either a positional TaskLocation, or a stable TaskAddress (workspaceId + taskId) |

### `completeTask`

Mark a task (or subtask, by ^id) as complete. Automatically records the completion date in the & token. If the task already has a start date recorded (from being moved out of a kanban first column), produces &(startDate, today). Optionally records the actual duration. In a kanban project the task moves to the top of the on-complete column (default: the last column; on-complete: none disables). A recurring (#every) open task also gets a fresh open instance for the next date, taking its old position.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `location` | object | Yes | Either a positional TaskLocation, or a stable TaskAddress (workspaceId + taskId) |
| `actual` | object | No | Optional actual duration to record |

### `uncompleteTask`

Mark a completed or cancelled task (or subtask, by ^id) as open. Preserves any existing & token (start/completion date). In a kanban project a task sitting in the on-complete column moves to the top of the first column.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `location` | object | Yes | Either a positional TaskLocation, or a stable TaskAddress (workspaceId + taskId) |

### `cancelTask`

Mark a task (or subtask, by ^id) as cancelled ([-]). No & token is added. In a kanban project the task moves to the top of the on-complete column, like a completed task.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `location` | object | Yes | Either a positional SubtaskLocation, or a stable TaskAddress (workspaceId + taskId) naming the subtask itself |

### `moveTask`

Move a task from one location to another (across workspaces, projects, or kanban columns). When a task leaves the first kanban column, its start date is automatically recorded. When an open task enters the on-complete column (default: the last kanban column; on-complete: none disables), it is automatically completed.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `from` | object | Yes | Either a positional TaskLocation, or a stable TaskAddress (workspaceId + taskId) |
| `to` | object | Yes |  |

### `reorderTask`

Change the position of a task within its current list or column.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `location` | object | Yes | Either a positional TaskLocation, or a stable TaskAddress (workspaceId + taskId) |
| `newIndex` | integer | Yes | New zero-based index for the task |

### `addSubtask`

Add a subtask to an existing task.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `parentLocation` | object | Yes | Either a positional TaskLocation, or a stable TaskAddress (workspaceId + taskId) |
| `subtask` | object | Yes |  |

### `updateSubtask`

Update one or more fields of an existing subtask.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `location` | object | Yes | Either a positional SubtaskLocation, or a stable TaskAddress (workspaceId + taskId) naming the subtask itself |
| `changes` | object | Yes |  |

### `deleteSubtask`

Delete a subtask from its parent task.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `location` | object | Yes | Either a positional SubtaskLocation, or a stable TaskAddress (workspaceId + taskId) naming the subtask itself |

### `assignTaskIds`

Assign a stable ^id to every task and subtask in the workspace that does not already have one, so they can all be addressed by id afterward.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `workspaceId` | string | Yes | ID of the target workspace |

## Project Operations

### `addProject`

Create a new project in a workspace. Kanban projects are initialized with three columns: Todo, In Progress, and Done.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `workspaceId` | string | Yes |  |
| `name` | string | Yes | Project name (becomes the H1 heading) |
| `layout` | string | Yes | Project layout type |
| `description` | string | No | Optional project description text |
| `folder` | boolean | No | Directory mode: create the project as <name>/todo.md in its own folder instead of a root file <name>.md (default false) |

### `updateProject`

Rename a project or update its description.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `workspaceId` | string | Yes |  |
| `projectIndex` | integer | Yes |  |
| `changes` | object | Yes |  |

### `deleteProject`

Delete a project and all its tasks permanently.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `workspaceId` | string | Yes |  |
| `projectIndex` | integer | Yes |  |

### `reorderProject`

Move a project to a different position within its workspace.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `workspaceId` | string | Yes |  |
| `projectIndex` | integer | Yes |  |
| `newIndex` | integer | Yes |  |

### `addColumn`

Add a new column to a kanban project. Only valid on kanban projects.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `workspaceId` | string | Yes |  |
| `projectIndex` | integer | Yes |  |
| `columnName` | string | Yes |  |
| `atIndex` | integer | No | Optional insertion index (appends if omitted) |

### `renameColumn`

Rename a column in a kanban project.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `workspaceId` | string | Yes |  |
| `projectIndex` | integer | Yes |  |
| `columnIndex` | integer | Yes |  |
| `newName` | string | Yes |  |

### `deleteColumn`

Delete a column from a kanban project. Tasks must be explicitly moved to another column or deleted — they are never silently dropped. Use moveTasks: "delete" to remove tasks, or moveTasks: { targetColumnIndex } to move them.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `workspaceId` | string | Yes |  |
| `projectIndex` | integer | Yes |  |
| `columnIndex` | integer | Yes |  |
| `moveTasks` | object | Yes |  |

### `reorderColumn`

Move a column to a different position within its kanban project.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `workspaceId` | string | Yes |  |
| `projectIndex` | integer | Yes |  |
| `columnIndex` | integer | Yes |  |
| `newIndex` | integer | Yes |  |

## Query Operations

### `getOverdueTasks`

Return all incomplete tasks with a due date before today (or a specified date), across all workspaces.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `asOfDate` | string | No | Reference date as YYYY-MM-DD (defaults to today) |

### `getTasksDueInRange`

Return all incomplete tasks whose due date falls within the given date range (inclusive).

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `startDate` | string | Yes | Start of range as YYYY-MM-DD (inclusive) |
| `endDate` | string | Yes | End of range as YYYY-MM-DD (inclusive) |

### `getTasksByContext`

Return all tasks that have the specified @context label.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `context` | string | Yes | Context label without the @ prefix |

### `getTasksByTag`

Return all tasks that have the specified #tag (label or nested-tag key).

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `tag` | string | Yes | Tag name without the # prefix |

### `getNextActions`

GTD "next actions": for each context, return the incomplete task with the highest value-to-complexity ratio. Tasks with no context appear under the "__inbox__" key. Optionally scoped to one workspace/project.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `workspaceId` | string | No | Restrict to one workspace (optional) |
| `projectIndex` | integer | No | Restrict to one project (optional) |

### `getEstimationAccuracy`

For completed tasks that have both an estimated effort (*) and an actual duration (&), compute the ratio of actual to estimated time and return summary statistics, bucketed overall, by effective owner, and by complexity.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `workspaceId` | string | No | Filter to a specific workspace (optional) |
| `projectIndex` | integer | No | Filter to a specific project (optional) |

### `searchTasks`

Full-text search across task descriptions and tags. Returns all matching tasks with their locations.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `query` | string | Yes | Search string |

### `listTasks`

General-purpose task listing with independently composable filters — the catch-all query the more specific ones (getOverdueTasks, getTasksByTag, ...) are special cases of.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `workspaceId` | string | No |  |
| `projectIndex` | integer | No |  |
| `context` | string | No | @context label without the @ prefix |
| `tag` | string | No | #tag name without the # prefix |
| `owner` | string | No | Effective owner (#owner/ tag, else inherited default) |
| `area` | string | No | Project frontmatter's area |
| `checkboxState` | string | No |  |
| `dueBefore` | string | No | YYYY-MM-DD, exclusive |
| `dueAfter` | string | No | YYYY-MM-DD, exclusive |
| `deferPassed` | boolean | No | true: open tasks whose defer date has arrived |
| `waiting` | boolean | No | Filter by presence of a #waiting/ tag |
| `withScores` | boolean | No | Attach a `score` object (importance, urgency, risk, fit — the same shape `score` returns) to every row, all computed in one pass from the same state and date. Rows are not sorted or ranked by it. |

### `getWaitingFor`

Return every open task carrying a #waiting/ tag.

### `score`

Compute the four independent prioritization signals (importance, urgency, risk, fit) for one task — computed only, never persisted. The format is deliberately unopinionated about how to combine them.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `location` | object | Yes | Either a positional TaskLocation, or a stable TaskAddress (workspaceId + taskId) |

## Batch Operations

### `applyBatch`

Apply a sequence of operations atomically. If any operation fails, all changes are rolled back and the original state is returned. Critical for AI-proposed multi-step changes.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `operations` | array | Yes |  |

