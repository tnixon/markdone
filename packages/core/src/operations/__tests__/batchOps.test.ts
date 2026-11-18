import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { applyBatch } from '../batchOps';
import { getTasks, getColumns } from '../../model/accessors';
import { makeAppState, makeChecklist, makeKanban, WORKSPACE_ID, EMPTY_FRONTMATTER } from './helpers';

function freshState() {
  return makeAppState(WORKSPACE_ID, makeChecklist([
    { text: 'Task A' },
    { text: 'Task B' },
    { text: 'Task C' },
  ]));
}

describe('applyBatch - success cases', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-08-01T12:00:00'));
  });
  afterEach(() => { vi.useRealTimers(); });

  test('applies single operation', () => {
    const state = freshState();
    const result = applyBatch(state, [
      { op: 'addTask', params: { workspaceId: WORKSPACE_ID, projectIndex: 0, task: { text: 'New task' } } },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tasks = getTasks(result.value.state.workspaces[0].todoFile.projects[0] as any);
    expect(tasks).toHaveLength(4);
  });

  test('applies multiple operations sequentially', () => {
    const state = freshState();
    const result = applyBatch(state, [
      { op: 'addTask', params: { workspaceId: WORKSPACE_ID, projectIndex: 0, task: { text: 'Task D' } } },
      { op: 'deleteTask', params: { location: { workspaceId: WORKSPACE_ID, projectIndex: 0, taskIndex: 0 } } },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tasks = getTasks(result.value.state.workspaces[0].todoFile.projects[0] as any);
    expect(tasks).toHaveLength(3);
    const texts = tasks.map((t: any) => t.text);
    expect(texts).not.toContain('Task A');
    expect(texts).toContain('Task D');
  });

  test('returns individual result for each operation', () => {
    const state = freshState();
    const result = applyBatch(state, [
      { op: 'addTask', params: { workspaceId: WORKSPACE_ID, projectIndex: 0, task: { text: 'X' } } },
      { op: 'addTask', params: { workspaceId: WORKSPACE_ID, projectIndex: 0, task: { text: 'Y' } } },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.results).toHaveLength(2);
    expect(result.value.results[0].ok).toBe(true);
    expect(result.value.results[1].ok).toBe(true);
  });

  test('applies project operations in batch', () => {
    const state = makeAppState(WORKSPACE_ID, { frontmatter: EMPTY_FRONTMATTER, preamble: [], projects: [] });
    const result = applyBatch(state, [
      { op: 'addProject', params: { workspaceId: WORKSPACE_ID, name: 'New Board', layout: 'kanban' } },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.workspaces[0].todoFile.projects).toHaveLength(1);
  });

  test('empty batch returns original state', () => {
    const state = freshState();
    const result = applyBatch(state, []);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state).toBe(state);
    expect(result.value.results).toHaveLength(0);
  });

  test('compose: addTask then completeTask', () => {
    const state = makeAppState(WORKSPACE_ID, {
      frontmatter: EMPTY_FRONTMATTER,
      preamble: [],
      projects: [{ name: 'P', layout: 'checklist', frontmatter: EMPTY_FRONTMATTER, blocks: [] }],
    });
    const result = applyBatch(state, [
      { op: 'addTask', params: { workspaceId: WORKSPACE_ID, projectIndex: 0, task: { text: 'Must do' } } },
      { op: 'completeTask', params: { location: { workspaceId: WORKSPACE_ID, projectIndex: 0, taskIndex: 0 } } },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const task = getTasks(result.value.state.workspaces[0].todoFile.projects[0] as any)[0];
    expect(task.completed).toBe(true);
    expect(task.actual?.completionDate).toBe('2025-08-01');
  });
});

describe('applyBatch - rollback on failure', () => {
  test('rolls back all changes when an operation fails', () => {
    const state = freshState();
    const result = applyBatch(state, [
      { op: 'addTask', params: { workspaceId: WORKSPACE_ID, projectIndex: 0, task: { text: 'New' } } },
      { op: 'deleteTask', params: { location: { workspaceId: WORKSPACE_ID, projectIndex: 0, taskIndex: 99 } } }, // invalid
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('BATCH_FAILED');
  });

  test('original state is unchanged after rollback', () => {
    const state = freshState();
    const originalProject = state.workspaces[0].todoFile.projects[0];
    applyBatch(state, [
      { op: 'addTask', params: { workspaceId: WORKSPACE_ID, projectIndex: 0, task: { text: 'New' } } },
      { op: 'deleteTask', params: { location: { workspaceId: 'bad-ws', projectIndex: 0, taskIndex: 0 } } },
    ]);
    // Original state object should be untouched (immutable design)
    expect(state.workspaces[0].todoFile.projects[0]).toBe(originalProject);
  });

  test('returns error for unknown operation', () => {
    const state = freshState();
    const result = applyBatch(state, [
      { op: 'unknownOp', params: {} },
    ]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('UNKNOWN_OPERATION');
  });

  test('first operation failure prevents subsequent operations', () => {
    const state = freshState();
    const result = applyBatch(state, [
      { op: 'deleteTask', params: { location: { workspaceId: 'bad', projectIndex: 0, taskIndex: 0 } } }, // fails
      { op: 'addTask', params: { workspaceId: WORKSPACE_ID, projectIndex: 0, task: { text: 'Should not add' } } },
    ]);
    expect(result.ok).toBe(false);
    // State unchanged — task not added
    const tasks = getTasks(state.workspaces[0].todoFile.projects[0] as any);
    expect(tasks).toHaveLength(3);
  });
});

describe('applyBatch - all operation types', () => {
  test('handles updateTask', () => {
    const state = freshState();
    const result = applyBatch(state, [
      { op: 'updateTask', params: { location: { workspaceId: WORKSPACE_ID, projectIndex: 0, taskIndex: 0 }, changes: { text: 'Updated' } } },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const task = getTasks(result.value.state.workspaces[0].todoFile.projects[0] as any)[0];
    expect(task.text).toBe('Updated');
  });

  test('handles reorderTask', () => {
    const state = freshState();
    const result = applyBatch(state, [
      { op: 'reorderTask', params: { location: { workspaceId: WORKSPACE_ID, projectIndex: 0, taskIndex: 0 }, newIndex: 2 } },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tasks = getTasks(result.value.state.workspaces[0].todoFile.projects[0] as any);
    expect(tasks[2].text).toBe('Task A');
  });

  test('handles addSubtask', () => {
    const state = freshState();
    const result = applyBatch(state, [
      { op: 'addSubtask', params: { parentLocation: { workspaceId: WORKSPACE_ID, projectIndex: 0, taskIndex: 0 }, subtask: { text: 'Sub' } } },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const task = getTasks(result.value.state.workspaces[0].todoFile.projects[0] as any)[0];
    expect(task.subtasks).toHaveLength(1);
  });

  test('handles updateProject', () => {
    const state = freshState();
    const result = applyBatch(state, [
      { op: 'updateProject', params: { workspaceId: WORKSPACE_ID, projectIndex: 0, changes: { name: 'Renamed' } } },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.state.workspaces[0].todoFile.projects[0].name).toBe('Renamed');
  });

  test('handles kanban operations in batch', () => {
    const state = makeAppState(WORKSPACE_ID, makeKanban());
    const result = applyBatch(state, [
      { op: 'addColumn', params: { workspaceId: WORKSPACE_ID, projectIndex: 0, columnName: 'Review' } },
      { op: 'renameColumn', params: { workspaceId: WORKSPACE_ID, projectIndex: 0, columnIndex: 0, newName: 'Backlog' } },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const project = result.value.state.workspaces[0].todoFile.projects[0];
    if (project.layout === 'kanban') {
      const columns = getColumns(project);
      expect(columns).toHaveLength(4);
      expect(columns[0].name).toBe('Backlog');
      expect(columns[3].name).toBe('Review');
    }
  });
});
