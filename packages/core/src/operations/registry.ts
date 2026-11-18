import type { AppState } from '../model/types';
import type { OperationContext, OperationDefinition, QueryDefinition, AnthropicTool, JSONSchema, Result, TaskRef } from './types';
import type { BatchOperation } from './batchOps';
import { operationHandlers } from './dispatch';
import { applyBatch } from './batchOps';
import { localToday, resolveTaskRef } from './utils';
import { getTasks, getColumns, getColumnTasks } from '../model/accessors';
import {
  getOverdueTasks,
  getTasksDueInRange,
  getTasksByContext,
  getTasksByTag,
  getNextActions,
  getEstimationAccuracy,
  searchTasks,
  listTasks,
  getWaitingFor,
  score,
  findWorkspaceAndProject,
  withScores,
  type ListTasksFilters,
} from './queryOps';

// ---- Shared schema fragments ----

const taskLocationSchema: JSONSchema = {
  type: 'object',
  properties: {
    workspaceId: { type: 'string', description: 'ID of the workspace' },
    projectIndex: { type: 'integer', description: 'Zero-based index of the project' },
    columnIndex: { type: 'integer', description: 'Zero-based column index (kanban only)' },
    taskIndex: { type: 'integer', description: 'Zero-based index of the task within its list' },
  },
  required: ['workspaceId', 'projectIndex', 'taskIndex'],
};

const subtaskLocationSchema: JSONSchema = {
  type: 'object',
  properties: {
    workspaceId: { type: 'string' },
    projectIndex: { type: 'integer' },
    columnIndex: { type: 'integer' },
    taskIndex: { type: 'integer' },
    subtaskIndex: { type: 'integer', description: 'Zero-based index of the subtask' },
  },
  required: ['workspaceId', 'projectIndex', 'taskIndex', 'subtaskIndex'],
};

// A stable, position-independent reference: workspaceId + the task's own
// `^id`. Resolved to a location at execution time (see resolveTaskRef /
// resolveSubtaskRef in operations/utils.ts) rather than up front, since a
// position resolved too early can go stale before it's acted on.
const taskAddressSchema: JSONSchema = {
  type: 'object',
  properties: {
    workspaceId: { type: 'string', description: 'ID of the workspace' },
    taskId: { type: 'string', description: "The task's stable ^id" },
  },
  required: ['workspaceId', 'taskId'],
};

const taskRefSchema: JSONSchema = {
  description: 'Either a positional TaskLocation, or a stable TaskAddress (workspaceId + taskId)',
  oneOf: [taskLocationSchema, taskAddressSchema],
};

const subtaskRefSchema: JSONSchema = {
  description:
    'Either a positional SubtaskLocation, or a stable TaskAddress (workspaceId + taskId) naming the subtask itself',
  oneOf: [subtaskLocationSchema, taskAddressSchema],
};

const effortSchema: JSONSchema = {
  type: 'object',
  properties: {
    amount: { type: 'number' },
    unit: { type: 'string', enum: ['min', 'hrs', 'days', 'wks'] },
  },
  required: ['amount', 'unit'],
};

const newTaskInputSchema: JSONSchema = {
  type: 'object',
  properties: {
    text: { type: 'string', description: 'Task description text' },
    dueDate: { type: 'string', description: 'Due date as YYYY-MM-DD' },
    contexts: { type: 'array', items: { type: 'string' }, description: '@context labels' },
    value: { type: 'number', description: 'Value score ($)' },
    complexity: { type: 'number', description: 'Complexity score (%)' },
    effort: { ...effortSchema, description: 'Estimated effort (*)' },
    tags: {
      type: 'array',
      items: {
        oneOf: [
          {
            type: 'object',
            properties: { type: { const: 'label' }, name: { type: 'string' } },
            required: ['type', 'name'],
          },
          {
            type: 'object',
            properties: {
              type: { const: 'nested' },
              key: { type: 'string' },
              value: { type: 'string' },
            },
            required: ['type', 'key', 'value'],
          },
        ],
      },
    },
  },
  required: ['text'],
};

const taskFieldsSchema: JSONSchema = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    blockId: {
      type: 'string',
      description: "The task's ^id (1-64 letters, digits, hyphens; unique in the workspace), without the caret",
    },
    dueDate: { type: 'string' },
    contexts: { type: 'array', items: { type: 'string' } },
    value: { type: 'number' },
    complexity: { type: 'number' },
    effort: effortSchema,
    actual: {
      type: 'object',
      properties: {
        completionDate: { type: 'string' },
        startDate: { type: 'string' },
        duration: effortSchema,
      },
      required: ['completionDate'],
    },
    tags: { type: 'array', items: { type: 'object' } },
  },
};

const appStateResult: JSONSchema = {
  type: 'object',
  description: 'Result containing the updated AppState or an error',
};

// ---- execute/describe helpers ----

// Wraps a plain data-returning query function as a `QueryDefinition.execute`
// — converting a thrown error into a `Result` failure, since `runOperation`
// promises a uniform Result-returning entry point regardless of operation.
function asQueryExecute(
  fn: (state: AppState, input: Record<string, unknown>, ctx?: OperationContext) => unknown,
): QueryDefinition['execute'] {
  return (state, input, ctx) => {
    try {
      return { ok: true, value: fn(state, input, ctx) };
    } catch (e) {
      return { ok: false, error: { code: 'QUERY_FAILED', message: e instanceof Error ? e.message : String(e) } };
    }
  };
}

// ---- Operation definitions ----

const taskOperations: OperationDefinition[] = [
  {
    name: 'addTask',
    category: 'task',
    description:
      'Add a new task to a project. For kanban projects, specify columnIndex to target a column (defaults to the first column). The task is appended to the end of the list.',
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'ID of the target workspace' },
        projectIndex: { type: 'integer', description: 'Zero-based index of the target project' },
        columnIndex: { type: 'integer', description: 'Column index for kanban projects (optional, defaults to 0)' },
        task: newTaskInputSchema,
        assignId: {
          type: 'boolean',
          description: 'Assign the new task a stable ^id (default true) so it can be addressed by id afterward',
        },
      },
      required: ['workspaceId', 'projectIndex', 'task'],
    },
    returns: appStateResult,
    mutating: true,
    execute: operationHandlers.addTask,
    describe: input => `Add task: "${(input.task as Record<string, unknown>)?.text}"`,
  },
  {
    name: 'updateTask',
    category: 'task',
    description:
      'Update one or more fields of an existing task. Only the provided fields are changed; all others remain unchanged.',
    parameters: {
      type: 'object',
      properties: {
        location: taskRefSchema,
        changes: taskFieldsSchema,
      },
      required: ['location', 'changes'],
    },
    returns: appStateResult,
    mutating: true,
    execute: operationHandlers.updateTask,
    describe: () => 'Update task',
  },
  {
    name: 'deleteTask',
    category: 'task',
    description: 'Delete a task and all its subtasks permanently.',
    parameters: {
      type: 'object',
      properties: { location: taskRefSchema },
      required: ['location'],
    },
    returns: appStateResult,
    mutating: true,
    execute: operationHandlers.deleteTask,
    describe: () => 'Delete task',
  },
  {
    name: 'completeTask',
    category: 'task',
    description:
      'Mark a task (or subtask, by ^id) as complete. Automatically records the completion date in the & token. If the task already has a start date recorded (from being moved out of a kanban first column), produces &(startDate, today). Optionally records the actual duration. In a kanban project the task moves to the top of the on-complete column (default: the last column; on-complete: none disables). A recurring (#every) open task also gets a fresh open instance for the next date, taking its old position.',
    parameters: {
      type: 'object',
      properties: {
        location: taskRefSchema,
        actual: {
          type: 'object',
          properties: { duration: effortSchema },
          description: 'Optional actual duration to record',
        },
      },
      required: ['location'],
    },
    returns: appStateResult,
    mutating: true,
    execute: operationHandlers.completeTask,
    describe: () => 'Mark task complete',
  },
  {
    name: 'uncompleteTask',
    category: 'task',
    description:
      'Mark a completed or cancelled task (or subtask, by ^id) as open. Preserves any existing & token (start/completion date). In a kanban project a task sitting in the on-complete column moves to the top of the first column.',
    parameters: {
      type: 'object',
      properties: { location: taskRefSchema },
      required: ['location'],
    },
    returns: appStateResult,
    mutating: true,
    execute: operationHandlers.uncompleteTask,
    describe: () => 'Mark task incomplete',
  },
  {
    name: 'cancelTask',
    category: 'task',
    description:
      'Mark a task (or subtask, by ^id) as cancelled ([-]). No & token is added. In a kanban project the task moves to the top of the on-complete column, like a completed task.',
    parameters: {
      type: 'object',
      properties: { location: subtaskRefSchema },
      required: ['location'],
    },
    returns: appStateResult,
    mutating: true,
    execute: operationHandlers.cancelTask,
    describe: () => 'Mark task cancelled',
  },
  {
    name: 'moveTask',
    category: 'task',
    description:
      'Move a task from one location to another (across workspaces, projects, or kanban columns). When a task leaves the first kanban column, its start date is automatically recorded. When an open task enters the on-complete column (default: the last kanban column; on-complete: none disables), it is automatically completed.',
    parameters: {
      type: 'object',
      properties: {
        from: taskRefSchema,
        to: taskLocationSchema,
      },
      required: ['from', 'to'],
    },
    returns: appStateResult,
    mutating: true,
    execute: operationHandlers.moveTask,
    describe: () => 'Move task',
  },
  {
    name: 'reorderTask',
    category: 'task',
    description: 'Change the position of a task within its current list or column.',
    parameters: {
      type: 'object',
      properties: {
        location: taskRefSchema,
        newIndex: { type: 'integer', description: 'New zero-based index for the task' },
      },
      required: ['location', 'newIndex'],
    },
    returns: appStateResult,
    mutating: true,
    execute: operationHandlers.reorderTask,
    describe: () => 'Reorder task',
  },
  {
    name: 'addSubtask',
    category: 'task',
    description: 'Add a subtask to an existing task.',
    parameters: {
      type: 'object',
      properties: {
        parentLocation: taskRefSchema,
        subtask: newTaskInputSchema,
      },
      required: ['parentLocation', 'subtask'],
    },
    returns: appStateResult,
    mutating: true,
    execute: operationHandlers.addSubtask,
    describe: input => `Add subtask: "${(input.subtask as Record<string, unknown>)?.text}"`,
  },
  {
    name: 'updateSubtask',
    category: 'task',
    description: 'Update one or more fields of an existing subtask.',
    parameters: {
      type: 'object',
      properties: {
        location: subtaskRefSchema,
        changes: taskFieldsSchema,
      },
      required: ['location', 'changes'],
    },
    returns: appStateResult,
    mutating: true,
    execute: operationHandlers.updateSubtask,
    describe: () => 'Update subtask',
  },
  {
    name: 'deleteSubtask',
    category: 'task',
    description: 'Delete a subtask from its parent task.',
    parameters: {
      type: 'object',
      properties: { location: subtaskRefSchema },
      required: ['location'],
    },
    returns: appStateResult,
    mutating: true,
    execute: operationHandlers.deleteSubtask,
    describe: () => 'Delete subtask',
  },
  {
    name: 'assignTaskIds',
    category: 'task',
    description:
      'Assign a stable ^id to every task and subtask in the workspace that does not already have one, so they can all be addressed by id afterward.',
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'ID of the target workspace' },
      },
      required: ['workspaceId'],
    },
    returns: appStateResult,
    mutating: true,
    execute: operationHandlers.assignTaskIds,
    describe: () => 'Assign stable ids to all tasks in the workspace',
  },
];

const projectOperations: OperationDefinition[] = [
  {
    name: 'addProject',
    category: 'project',
    description:
      'Create a new project in a workspace. Kanban projects are initialized with three columns: Todo, In Progress, and Done.',
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string' },
        name: { type: 'string', description: 'Project name (becomes the H1 heading)' },
        layout: { type: 'string', enum: ['checklist', 'kanban'], description: 'Project layout type' },
        description: { type: 'string', description: 'Optional project description text' },
        folder: {
          type: 'boolean',
          description:
            'Directory mode: create the project as <name>/todo.md in its own folder instead of a root file <name>.md (default false)',
        },
      },
      required: ['workspaceId', 'name', 'layout'],
    },
    returns: appStateResult,
    mutating: true,
    execute: operationHandlers.addProject,
    describe: input => `Add project: "${input.name}"`,
  },
  {
    name: 'updateProject',
    category: 'project',
    description: 'Rename a project or update its description.',
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string' },
        projectIndex: { type: 'integer' },
        changes: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
          },
        },
      },
      required: ['workspaceId', 'projectIndex', 'changes'],
    },
    returns: appStateResult,
    mutating: true,
    execute: operationHandlers.updateProject,
    describe: () => 'Update project',
  },
  {
    name: 'deleteProject',
    category: 'project',
    description: 'Delete a project and all its tasks permanently.',
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string' },
        projectIndex: { type: 'integer' },
      },
      required: ['workspaceId', 'projectIndex'],
    },
    returns: appStateResult,
    mutating: true,
    execute: operationHandlers.deleteProject,
    describe: () => 'Delete project',
  },
  {
    name: 'reorderProject',
    category: 'project',
    description: 'Move a project to a different position within its workspace.',
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string' },
        projectIndex: { type: 'integer' },
        newIndex: { type: 'integer' },
      },
      required: ['workspaceId', 'projectIndex', 'newIndex'],
    },
    returns: appStateResult,
    mutating: true,
    execute: operationHandlers.reorderProject,
    describe: () => 'Reorder project',
  },
  {
    name: 'addColumn',
    category: 'project',
    description: 'Add a new column to a kanban project. Only valid on kanban projects.',
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string' },
        projectIndex: { type: 'integer' },
        columnName: { type: 'string' },
        atIndex: { type: 'integer', description: 'Optional insertion index (appends if omitted)' },
      },
      required: ['workspaceId', 'projectIndex', 'columnName'],
    },
    returns: appStateResult,
    mutating: true,
    execute: operationHandlers.addColumn,
    describe: input => `Add column: "${input.columnName}"`,
  },
  {
    name: 'renameColumn',
    category: 'project',
    description: 'Rename a column in a kanban project.',
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string' },
        projectIndex: { type: 'integer' },
        columnIndex: { type: 'integer' },
        newName: { type: 'string' },
      },
      required: ['workspaceId', 'projectIndex', 'columnIndex', 'newName'],
    },
    returns: appStateResult,
    mutating: true,
    execute: operationHandlers.renameColumn,
    describe: input => `Rename column to "${input.newName}"`,
  },
  {
    name: 'deleteColumn',
    category: 'project',
    description:
      'Delete a column from a kanban project. Tasks must be explicitly moved to another column or deleted — they are never silently dropped. Use moveTasks: "delete" to remove tasks, or moveTasks: { targetColumnIndex } to move them.',
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string' },
        projectIndex: { type: 'integer' },
        columnIndex: { type: 'integer' },
        moveTasks: {
          oneOf: [
            { type: 'string', const: 'delete', description: 'Delete all tasks in the column' },
            {
              type: 'object',
              properties: { targetColumnIndex: { type: 'integer' } },
              required: ['targetColumnIndex'],
              description: 'Move tasks to the specified column',
            },
          ],
        },
      },
      required: ['workspaceId', 'projectIndex', 'columnIndex', 'moveTasks'],
    },
    returns: appStateResult,
    mutating: true,
    execute: operationHandlers.deleteColumn,
    describe: () => 'Delete column',
  },
  {
    name: 'reorderColumn',
    category: 'project',
    description: 'Move a column to a different position within its kanban project.',
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string' },
        projectIndex: { type: 'integer' },
        columnIndex: { type: 'integer' },
        newIndex: { type: 'integer' },
      },
      required: ['workspaceId', 'projectIndex', 'columnIndex', 'newIndex'],
    },
    returns: appStateResult,
    mutating: true,
    execute: operationHandlers.reorderColumn,
    describe: () => 'Reorder column',
  },
];

const queryOperations: OperationDefinition[] = [
  {
    name: 'getOverdueTasks',
    category: 'query',
    description: 'Return all incomplete tasks with a due date before today (or a specified date), across all workspaces.',
    parameters: {
      type: 'object',
      properties: {
        asOfDate: { type: 'string', description: 'Reference date as YYYY-MM-DD (defaults to today)' },
      },
    },
    returns: { type: 'array', items: { type: 'object' } },
    mutating: false,
    execute: asQueryExecute((state, input, ctx) =>
      getOverdueTasks(state, (input.asOfDate as string | undefined) ?? ctx?.today),
    ),
  },
  {
    name: 'getTasksDueInRange',
    category: 'query',
    description: 'Return all incomplete tasks whose due date falls within the given date range (inclusive).',
    parameters: {
      type: 'object',
      properties: {
        startDate: { type: 'string', description: 'Start of range as YYYY-MM-DD (inclusive)' },
        endDate: { type: 'string', description: 'End of range as YYYY-MM-DD (inclusive)' },
      },
      required: ['startDate', 'endDate'],
    },
    returns: { type: 'array', items: { type: 'object' } },
    mutating: false,
    execute: asQueryExecute((state, input) => getTasksDueInRange(state, input.startDate as string, input.endDate as string)),
  },
  {
    name: 'getTasksByContext',
    category: 'query',
    description: 'Return all tasks that have the specified @context label.',
    parameters: {
      type: 'object',
      properties: { context: { type: 'string', description: 'Context label without the @ prefix' } },
      required: ['context'],
    },
    returns: { type: 'array', items: { type: 'object' } },
    mutating: false,
    execute: asQueryExecute((state, input) => getTasksByContext(state, input.context as string)),
  },
  {
    name: 'getTasksByTag',
    category: 'query',
    description: 'Return all tasks that have the specified #tag (label or nested-tag key).',
    parameters: {
      type: 'object',
      properties: { tag: { type: 'string', description: 'Tag name without the # prefix' } },
      required: ['tag'],
    },
    returns: { type: 'array', items: { type: 'object' } },
    mutating: false,
    execute: asQueryExecute((state, input) => getTasksByTag(state, input.tag as string)),
  },
  {
    name: 'getNextActions',
    category: 'query',
    description:
      'GTD "next actions": for each context, return the incomplete task with the highest value-to-complexity ratio. Tasks with no context appear under the "__inbox__" key. Optionally scoped to one workspace/project.',
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Restrict to one workspace (optional)' },
        projectIndex: { type: 'integer', description: 'Restrict to one project (optional)' },
      },
    },
    returns: { type: 'object', description: 'Map of context → TaskWithLocation, as a plain object' },
    mutating: false,
    execute: asQueryExecute((state, input) => {
      const map = getNextActions(state, {
        workspaceId: input.workspaceId as string | undefined,
        projectIndex: input.projectIndex as number | undefined,
      });
      return Object.fromEntries(map.entries());
    }),
  },
  {
    name: 'getEstimationAccuracy',
    category: 'query',
    description:
      'For completed tasks that have both an estimated effort (*) and an actual duration (&), compute the ratio of actual to estimated time and return summary statistics, bucketed overall, by effective owner, and by complexity.',
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string', description: 'Filter to a specific workspace (optional)' },
        projectIndex: { type: 'integer', description: 'Filter to a specific project (optional)' },
      },
    },
    returns: { type: 'object', description: 'EstimationAccuracyStats' },
    mutating: false,
    execute: asQueryExecute((state, input) =>
      getEstimationAccuracy(state, input.workspaceId as string | undefined, input.projectIndex as number | undefined),
    ),
  },
  {
    name: 'searchTasks',
    category: 'query',
    description: 'Full-text search across task descriptions and tags. Returns all matching tasks with their locations.',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Search string' } },
      required: ['query'],
    },
    returns: { type: 'array', items: { type: 'object' } },
    mutating: false,
    execute: asQueryExecute((state, input) => searchTasks(state, input.query as string)),
  },
  {
    name: 'listTasks',
    category: 'query',
    description:
      'General-purpose task listing with independently composable filters — the catch-all query the more specific ones (getOverdueTasks, getTasksByTag, ...) are special cases of.',
    parameters: {
      type: 'object',
      properties: {
        workspaceId: { type: 'string' },
        projectIndex: { type: 'integer' },
        context: { type: 'string', description: '@context label without the @ prefix' },
        tag: { type: 'string', description: '#tag name without the # prefix' },
        owner: { type: 'string', description: 'Effective owner (#owner/ tag, else inherited default)' },
        area: { type: 'string', description: "Project frontmatter's area" },
        checkboxState: { type: 'string', enum: ['open', 'done', 'cancelled', 'other'] },
        dueBefore: { type: 'string', description: 'YYYY-MM-DD, exclusive' },
        dueAfter: { type: 'string', description: 'YYYY-MM-DD, exclusive' },
        deferPassed: { type: 'boolean', description: 'true: open tasks whose defer date has arrived' },
        waiting: { type: 'boolean', description: 'Filter by presence of a #waiting/ tag' },
        withScores: {
          type: 'boolean',
          description:
            "Attach a `score` object (importance, urgency, risk, fit — the same shape `score` returns) to every row, all computed in one pass from the same state and date. Rows are not sorted or ranked by it.",
        },
      },
    },
    returns: { type: 'array', items: { type: 'object' } },
    mutating: false,
    execute: asQueryExecute((state, input, ctx) => {
      const { withScores: scored, ...filters } = input;
      const today = ctx?.today ?? localToday();
      const items = listTasks(state, filters as ListTasksFilters, today);
      return scored === true ? withScores(state, items, today) : items;
    }),
  },
  {
    name: 'getWaitingFor',
    category: 'query',
    description: 'Return every open task carrying a #waiting/ tag.',
    parameters: { type: 'object', properties: {} },
    returns: { type: 'array', items: { type: 'object' } },
    mutating: false,
    execute: asQueryExecute(state => getWaitingFor(state)),
  },
  {
    name: 'score',
    category: 'query',
    description:
      'Compute the four independent prioritization signals (importance, urgency, risk, fit) for one task — computed only, never persisted. The format is deliberately unopinionated about how to combine them.',
    parameters: {
      type: 'object',
      properties: {
        location: taskRefSchema,
      },
      required: ['location'],
    },
    returns: { type: 'object', description: 'TaskScore' },
    mutating: false,
    execute: (state, input, ctx) => scoreExecute(state, input, ctx),
  },
];

// `score` operates on a resolved (task, project, workspace) triple rather
// than AppState + params directly, unlike every other query — this adapts
// it to the same `execute(state, input)` shape as the rest of the registry,
// reusing `resolveTaskRef` so `score` accepts either a TaskLocation or a
// stable TaskAddress just like the mutating task operations do.
function scoreExecute(state: AppState, input: Record<string, unknown>, ctx?: OperationContext): Result<unknown> {
  const locationResult = resolveTaskRef(state, input.location as TaskRef);
  if (!locationResult.ok) return locationResult;
  const location = locationResult.value;

  const { workspace, project } = findWorkspaceAndProject(state, location);
  const tasks =
    project.layout === 'checklist' ? getTasks(project) : getColumnTasks(getColumns(project)[location.columnIndex ?? 0]);
  const task = tasks[location.taskIndex];
  if (!task) {
    return { ok: false, error: { code: 'TASK_NOT_FOUND', message: `Task at index ${location.taskIndex} not found` } };
  }
  return { ok: true, value: score(task, project, workspace, ctx?.today) };
}

const batchOperations: OperationDefinition[] = [
  {
    name: 'applyBatch',
    category: 'batch',
    description:
      'Apply a sequence of operations atomically. If any operation fails, all changes are rolled back and the original state is returned. Critical for AI-proposed multi-step changes.',
    parameters: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              op: { type: 'string', description: 'Operation name' },
              params: { type: 'object', description: 'Operation parameters' },
            },
            required: ['op', 'params'],
          },
        },
      },
      required: ['operations'],
    },
    returns: appStateResult,
    mutating: true,
    execute: (state, input, ctx) => {
      const result = applyBatch(state, input.operations as BatchOperation[], ctx);
      if (!result.ok) return result;
      return { ok: true, value: result.value.state };
    },
    describe: input => `Apply ${(input.operations as BatchOperation[] | undefined)?.length ?? 0} operations`,
  },
];

export const operationRegistry: OperationDefinition[] = [
  ...taskOperations,
  ...projectOperations,
  ...queryOperations,
  ...batchOperations,
];

export const operationsByName: Map<string, OperationDefinition> = new Map(
  operationRegistry.map(op => [op.name, op]),
);

export function getOperation(name: string): OperationDefinition | undefined {
  return operationsByName.get(name);
}

/**
 * Look up an operation by name and run it. The single entry point every
 * consumer (batch ops, an AI tool bridge, a future CLI/MCP server) can use
 * instead of hand-rolling a name → function switch.
 */
export function runOperation(
  name: string,
  state: AppState,
  input: Record<string, unknown>,
  ctx?: OperationContext,
): Result<unknown> {
  const op = operationsByName.get(name);
  if (!op) {
    return { ok: false, error: { code: 'UNKNOWN_OPERATION', message: `Unknown operation: '${name}'` } };
  }
  return op.execute(state, input, ctx);
}

/**
 * Produce tool definitions in the Anthropic API tool-use format.
 */
export function toAnthropicTools(): AnthropicTool[] {
  return operationRegistry
    .filter(op => op.category !== 'batch') // applyBatch itself isn't a Claude tool
    .map(op => ({
      name: op.name,
      description: op.description,
      input_schema: {
        type: 'object' as const,
        properties: (op.parameters as { properties?: Record<string, JSONSchema> }).properties ?? {},
        required:
          (op.parameters as { required?: string[] }).required ?? [],
      },
    }));
}

/**
 * Produce a human-readable Markdown reference for all operations.
 */
export function toMarkdownReference(): string {
  const sections: string[] = [
    '# Markdone Operations Reference',
    '',
    'This document describes all operations available in the Markdone operations layer.',
    'All mutating operations return `Result<AppState>`. Query operations return data directly.',
    '',
  ];

  const categories: Array<{ label: string; key: OperationDefinition['category'] }> = [
    { label: 'Task Operations', key: 'task' },
    { label: 'Project Operations', key: 'project' },
    { label: 'Query Operations', key: 'query' },
    { label: 'Batch Operations', key: 'batch' },
  ];

  for (const { label, key } of categories) {
    const ops = operationRegistry.filter(op => op.category === key);
    if (ops.length === 0) continue;

    sections.push(`## ${label}`, '');

    for (const op of ops) {
      sections.push(`### \`${op.name}\``, '', op.description, '');

      const props = (op.parameters as { properties?: Record<string, JSONSchema> }).properties;
      const required = (op.parameters as { required?: string[] }).required ?? [];

      if (props && Object.keys(props).length > 0) {
        sections.push('**Parameters:**', '');
        sections.push('| Name | Type | Required | Description |');
        sections.push('|------|------|----------|-------------|');

        for (const [name, schema] of Object.entries(props)) {
          const s = schema as { type?: string; description?: string };
          const isRequired = required.includes(name);
          const typeStr = s.type ?? 'object';
          const desc = s.description ?? '';
          sections.push(`| \`${name}\` | ${typeStr} | ${isRequired ? 'Yes' : 'No'} | ${desc} |`);
        }

        sections.push('');
      }
    }
  }

  return sections.join('\n');
}
