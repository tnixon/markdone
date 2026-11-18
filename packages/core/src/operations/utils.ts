import type { AppState, Project, TodoFile, Workspace } from '../model/types';
import type { Result, TaskLocation, TaskRef, SubtaskLocation, SubtaskRef } from './types';
import { getTasks, getColumns, getColumnTasks } from '../model/accessors';

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(code: string, message: string): Result<T> {
  return { ok: false, error: { code, message } };
}

// The local calendar date as YYYY-MM-DD — not `toISOString()`, which is the
// UTC date and so a day behind for the first hours of a local day east of UTC.
export function localDateString(date: Date): string {
  const pad = (n: number, width = 2) => String(n).padStart(width, '0');
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// The one clock read in this package, for a caller that supplies no
// `OperationContext`/`today` of its own. The CLI and MCP server always
// supply one, derived from their injected clock.
export function localToday(): string {
  return localDateString(new Date());
}

export function resolveWorkspace(
  state: AppState,
  workspaceId: string,
): Result<{ workspace: Workspace; wsIndex: number }> {
  const wsIndex = state.workspaces.findIndex(ws => ws.config.id === workspaceId);
  if (wsIndex === -1) {
    return err('WORKSPACE_NOT_FOUND', `Workspace '${workspaceId}' not found`);
  }
  return ok({ workspace: state.workspaces[wsIndex], wsIndex });
}

export function resolveProject(workspace: Workspace, projectIndex: number): Result<Project> {
  if (projectIndex < 0 || projectIndex >= workspace.todoFile.projects.length) {
    return err('PROJECT_NOT_FOUND', `Project at index ${projectIndex} not found`);
  }
  return ok(workspace.todoFile.projects[projectIndex]);
}

export function updateWorkspace(state: AppState, workspaceId: string, newTodoFile: TodoFile): AppState {
  return {
    ...state,
    workspaces: state.workspaces.map(ws =>
      ws.config.id === workspaceId ? { ...ws, todoFile: newTodoFile } : ws,
    ),
  };
}

// Resolves a `TaskRef` to a concrete `TaskLocation` by walking the
// workspace's current task lists, matching `^id` (`Task.blockId`). A
// `TaskLocation` passed in is returned as-is — resolution only kicks in for
// a `TaskAddress`. Searches the same locations `TaskLocation` can already
// address (every checklist task; every kanban *column*, not auxiliary
// sections — those aren't addressable via `columnIndex` today either).
//
// Per spec, `^id` is workspace-unique; a duplicate is a resolution error
// rather than a silent first-match — the parser's `warnings` already flagged
// the duplicate at parse time, so resolution just refuses to guess.
export function resolveTaskRef(state: AppState, ref: TaskRef): Result<TaskLocation> {
  if (!('taskId' in ref)) return ok(ref);

  const wsResult = resolveWorkspace(state, ref.workspaceId);
  if (!wsResult.ok) return wsResult;

  const matches: TaskLocation[] = [];
  wsResult.value.workspace.todoFile.projects.forEach((project, projectIndex) => {
    if (project.layout === 'checklist') {
      getTasks(project).forEach((task, taskIndex) => {
        if (task.blockId === ref.taskId) matches.push({ workspaceId: ref.workspaceId, projectIndex, taskIndex });
      });
    } else {
      getColumns(project).forEach((column, columnIndex) => {
        getColumnTasks(column).forEach((task, taskIndex) => {
          if (task.blockId === ref.taskId) {
            matches.push({ workspaceId: ref.workspaceId, projectIndex, columnIndex, taskIndex });
          }
        });
      });
    }
  });

  if (matches.length === 0) {
    return err('TASK_NOT_FOUND', `No task with id '${ref.taskId}' found in workspace '${ref.workspaceId}'`);
  }
  if (matches.length > 1) {
    return err('DUPLICATE_TASK_ID', `Task id '${ref.taskId}' is not unique in workspace '${ref.workspaceId}'`);
  }
  return ok(matches[0]);
}

// Same as `resolveTaskRef`, one level down: matches a subtask's own `^id`
// rather than its parent's.
export function resolveSubtaskRef(state: AppState, ref: SubtaskRef): Result<SubtaskLocation> {
  if (!('taskId' in ref)) return ok(ref);

  const wsResult = resolveWorkspace(state, ref.workspaceId);
  if (!wsResult.ok) return wsResult;

  const matches: SubtaskLocation[] = [];
  wsResult.value.workspace.todoFile.projects.forEach((project, projectIndex) => {
    const lists: { columnIndex?: number; tasks: ReturnType<typeof getTasks> }[] =
      project.layout === 'checklist'
        ? [{ tasks: getTasks(project) }]
        : getColumns(project).map((column, columnIndex) => ({ columnIndex, tasks: getColumnTasks(column) }));

    for (const { columnIndex, tasks } of lists) {
      tasks.forEach((task, taskIndex) => {
        task.subtasks.forEach((subtask, subtaskIndex) => {
          if (subtask.blockId === ref.taskId) {
            matches.push({ workspaceId: ref.workspaceId, projectIndex, columnIndex, taskIndex, subtaskIndex });
          }
        });
      });
    }
  });

  if (matches.length === 0) {
    return err('TASK_NOT_FOUND', `No subtask with id '${ref.taskId}' found in workspace '${ref.workspaceId}'`);
  }
  if (matches.length > 1) {
    return err('DUPLICATE_TASK_ID', `Subtask id '${ref.taskId}' is not unique in workspace '${ref.workspaceId}'`);
  }
  return ok(matches[0]);
}
