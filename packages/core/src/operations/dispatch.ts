// Dispatch-by-operation-name for mutating task/project operations, shared by
// `batchOps.applyBatch` and the `WorkspaceHandle` implementations (which need
// to run a single named operation against a workspace's `TodoFile` without
// each having to know every operation's parameter shape). Query operations
// aren't included — they don't mutate and callers read state via
// `WorkspaceHandle.listProjects`/`getProject` instead.
//
// This is a bridge to the shape operations will have once the registry
// carries `execute` directly on each `OperationDefinition` (see registry.ts);
// at that point this map's job moves onto the registry itself.

import type { AppState } from '../model/types';
import type { OperationContext, Result } from './types';

import * as taskOps from './taskOps';
import * as projectOps from './projectOps';

export type OperationHandler = (state: AppState, params: Record<string, unknown>, ctx?: OperationContext) => Result<AppState>;

export const operationHandlers: Record<string, OperationHandler> = {
  // Task operations
  addTask: (state, p) =>
    taskOps.addTask(
      state,
      p.workspaceId as string,
      p.projectIndex as number,
      p.columnIndex as number | undefined,
      p.task as Parameters<typeof taskOps.addTask>[4],
      p.assignId as boolean | undefined,
    ),
  updateTask: (state, p) =>
    taskOps.updateTask(
      state,
      p.location as Parameters<typeof taskOps.updateTask>[1],
      p.changes as Parameters<typeof taskOps.updateTask>[2],
    ),
  deleteTask: (state, p) =>
    taskOps.deleteTask(state, p.location as Parameters<typeof taskOps.deleteTask>[1]),
  completeTask: (state, p, ctx) =>
    taskOps.completeTask(
      state,
      p.location as Parameters<typeof taskOps.completeTask>[1],
      p.actual as Parameters<typeof taskOps.completeTask>[2],
      ctx?.today,
    ),
  uncompleteTask: (state, p) =>
    taskOps.uncompleteTask(state, p.location as Parameters<typeof taskOps.uncompleteTask>[1]),
  cancelTask: (state, p) => taskOps.cancelTask(state, p.location as Parameters<typeof taskOps.cancelTask>[1]),
  moveTask: (state, p, ctx) =>
    taskOps.moveTask(
      state,
      p.from as Parameters<typeof taskOps.moveTask>[1],
      p.to as Parameters<typeof taskOps.moveTask>[2],
      ctx?.today,
    ),
  reorderTask: (state, p) =>
    taskOps.reorderTask(
      state,
      p.location as Parameters<typeof taskOps.reorderTask>[1],
      p.newIndex as number,
    ),
  addSubtask: (state, p) =>
    taskOps.addSubtask(
      state,
      p.parentLocation as Parameters<typeof taskOps.addSubtask>[1],
      p.subtask as Parameters<typeof taskOps.addSubtask>[2],
    ),
  updateSubtask: (state, p) =>
    taskOps.updateSubtask(
      state,
      p.location as Parameters<typeof taskOps.updateSubtask>[1],
      p.changes as Parameters<typeof taskOps.updateSubtask>[2],
    ),
  deleteSubtask: (state, p) =>
    taskOps.deleteSubtask(state, p.location as Parameters<typeof taskOps.deleteSubtask>[1]),
  assignTaskIds: (state, p) => taskOps.assignTaskIds(state, p.workspaceId as string),

  // Project operations
  addProject: (state, p) =>
    projectOps.addProject(
      state,
      p.workspaceId as string,
      p.name as string,
      p.layout as 'checklist' | 'kanban',
      p.description as string | undefined,
    ),
  updateProject: (state, p) =>
    projectOps.updateProject(
      state,
      p.workspaceId as string,
      p.projectIndex as number,
      p.changes as Parameters<typeof projectOps.updateProject>[3],
    ),
  deleteProject: (state, p) =>
    projectOps.deleteProject(state, p.workspaceId as string, p.projectIndex as number),
  reorderProject: (state, p) =>
    projectOps.reorderProject(
      state,
      p.workspaceId as string,
      p.projectIndex as number,
      p.newIndex as number,
    ),
  addColumn: (state, p) =>
    projectOps.addColumn(
      state,
      p.workspaceId as string,
      p.projectIndex as number,
      p.columnName as string,
      p.atIndex as number | undefined,
    ),
  renameColumn: (state, p) =>
    projectOps.renameColumn(
      state,
      p.workspaceId as string,
      p.projectIndex as number,
      p.columnIndex as number,
      p.newName as string,
    ),
  deleteColumn: (state, p) =>
    projectOps.deleteColumn(
      state,
      p.workspaceId as string,
      p.projectIndex as number,
      p.columnIndex as number,
      p.moveTasks as Parameters<typeof projectOps.deleteColumn>[4],
    ),
  reorderColumn: (state, p) =>
    projectOps.reorderColumn(
      state,
      p.workspaceId as string,
      p.projectIndex as number,
      p.columnIndex as number,
      p.newIndex as number,
    ),
};
