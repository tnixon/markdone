import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AppState, TodoFile } from '../../model/types';
import {
  addTask,
  updateTask,
  deleteTask,
  completeTask,
  uncompleteTask,
  moveTask,
  reorderTask,
  addSubtask,
  updateSubtask,
  deleteSubtask,
} from '../taskOps';
import { serialize } from '../../parser/serialize';
import { parse } from '../../parser/parse';
import { getTasks, getColumns, getColumnTasks } from '../../model/accessors';
import {
  makeChecklist,
  makeKanban,
  makeAppState,
  makeMultiWorkspaceState,
  makeTask,
  WORKSPACE_ID,
  newTask,
  EMPTY_FRONTMATTER,
} from './helpers';

const LOC0 = { workspaceId: WORKSPACE_ID, projectIndex: 0, taskIndex: 0 };
const LOC1 = { workspaceId: WORKSPACE_ID, projectIndex: 0, taskIndex: 1 };

function checklistState(taskCount = 2): AppState {
  const tasks = Array.from({ length: taskCount }, (_, i) =>
    makeTask({ id: `task-${i + 1}`, text: `Task ${i + 1}` }),
  );
  return makeAppState(WORKSPACE_ID, {
    frontmatter: EMPTY_FRONTMATTER,
    preamble: [],
    projects: [
      {
        name: 'P',
        layout: 'checklist',
        frontmatter: EMPTY_FRONTMATTER,
        blocks: tasks.map(task => ({ type: 'task' as const, task })),
      },
    ],
  });
}

describe('addTask', () => {
  test('adds task to checklist project', () => {
    const state = checklistState(0);
    const result = addTask(state, WORKSPACE_ID, 0, undefined, newTask);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const proj = result.value.workspaces[0].todoFile.projects[0];
    expect(getTasks(proj as any)).toHaveLength(1);
    expect(getTasks(proj as any)[0].text).toBe('New task');
  });

  test('appends task to end of list', () => {
    const state = checklistState(2);
    const result = addTask(state, WORKSPACE_ID, 0, undefined, { text: 'Last' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tasks = getTasks(result.value.workspaces[0].todoFile.projects[0] as any);
    expect(tasks).toHaveLength(3);
    expect(tasks[2].text).toBe('Last');
  });

  test('adds task to kanban project column 0 by default', () => {
    const state = makeAppState(WORKSPACE_ID, makeKanban());
    const result = addTask(state, WORKSPACE_ID, 0, undefined, { text: 'Kanban task' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const col0 = getColumns(result.value.workspaces[0].todoFile.projects[0] as any)[0];
    expect(getColumnTasks(col0)).toHaveLength(1);
  });

  test('adds task to specific kanban column', () => {
    const state = makeAppState(WORKSPACE_ID, makeKanban());
    const result = addTask(state, WORKSPACE_ID, 0, 2, { text: 'Done task' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const col2 = getColumns(result.value.workspaces[0].todoFile.projects[0] as any)[2];
    expect(getColumnTasks(col2)).toHaveLength(1);
  });

  test('returns error for missing workspace', () => {
    const state = checklistState();
    const result = addTask(state, 'bad-ws', 0, undefined, newTask);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('WORKSPACE_NOT_FOUND');
  });

  test('returns error for out-of-bounds project index', () => {
    const state = checklistState();
    const result = addTask(state, WORKSPACE_ID, 99, undefined, newTask);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PROJECT_NOT_FOUND');
  });

  test('returns error when specifying columnIndex on checklist project', () => {
    const state = checklistState();
    const result = addTask(state, WORKSPACE_ID, 0, 0, newTask);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_KANBAN_PROJECT');
  });

  test('new task has all provided fields', () => {
    const state = checklistState(0);
    const input = {
      text: 'Full task',
      dueDate: '2025-12-01',
      contexts: ['work'],
      value: 5,
      complexity: 3,
      effort: { amount: 2, unit: 'hrs' as const },
      tags: [{ type: 'label' as const, name: 'urgent' }],
    };
    const result = addTask(state, WORKSPACE_ID, 0, undefined, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const task = getTasks(result.value.workspaces[0].todoFile.projects[0] as any)[0];
    expect(task.text).toBe('Full task');
    expect(task.dueDate).toBe('2025-12-01');
    expect(task.contexts).toEqual(['work']);
    expect(task.value).toBe(5);
    expect(task.complexity).toBe(3);
    expect(task.effort).toEqual({ amount: 2, unit: 'hrs' });
    expect(task.tags).toEqual([{ type: 'label', name: 'urgent' }]);
  });

  test('does not mutate original state', () => {
    const state = checklistState(0);
    const originalProjects = state.workspaces[0].todoFile.projects;
    addTask(state, WORKSPACE_ID, 0, undefined, newTask);
    expect(state.workspaces[0].todoFile.projects).toBe(originalProjects);
  });
});

describe('updateTask', () => {
  test('updates task text', () => {
    const state = checklistState();
    const result = updateTask(state, LOC0, { text: 'Updated text' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const task = getTasks(result.value.workspaces[0].todoFile.projects[0] as any)[0];
    expect(task.text).toBe('Updated text');
  });

  test('updates only the specified fields', () => {
    const state = makeAppState(
      WORKSPACE_ID,
      makeChecklist([{ text: 'T', dueDate: '2025-01-01', value: 3 }]),
    );
    const result = updateTask(state, LOC0, { text: 'New text' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const task = getTasks(result.value.workspaces[0].todoFile.projects[0] as any)[0];
    expect(task.text).toBe('New text');
    expect(task.dueDate).toBe('2025-01-01');
    expect(task.value).toBe(3);
  });

  test('returns error for invalid task index', () => {
    const state = checklistState(1);
    const result = updateTask(state, { ...LOC0, taskIndex: 5 }, { text: 'x' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('TASK_NOT_FOUND');
  });

  test('does not mutate original state', () => {
    const state = checklistState();
    const originalTask = getTasks(state.workspaces[0].todoFile.projects[0] as any)[0];
    updateTask(state, LOC0, { text: 'changed' });
    expect(originalTask.text).toBe('Task 1');
  });
});

describe('deleteTask', () => {
  test('removes task by index', () => {
    const state = checklistState(3);
    const result = deleteTask(state, LOC1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tasks = getTasks(result.value.workspaces[0].todoFile.projects[0] as any);
    expect(tasks).toHaveLength(2);
    expect(tasks.map((t: any) => t.text)).toEqual(['Task 1', 'Task 3']);
  });

  test('returns error for invalid task index', () => {
    const state = checklistState(1);
    const result = deleteTask(state, { ...LOC0, taskIndex: 9 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('TASK_NOT_FOUND');
  });

  test('does not mutate original state', () => {
    const state = checklistState(2);
    const original = getTasks(state.workspaces[0].todoFile.projects[0] as any);
    deleteTask(state, LOC0);
    expect(original).toHaveLength(2);
  });
});

describe('completeTask', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-15T12:00:00'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('marks task as completed with today as completion date', () => {
    const state = checklistState(1);
    const result = completeTask(state, LOC0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const task = getTasks(result.value.workspaces[0].todoFile.projects[0] as any)[0];
    expect(task.completed).toBe(true);
    expect(task.actual).toEqual({ completionDate: '2025-06-15' });
  });

  test('uses existing actual.completionDate as start date when present', () => {
    const state = makeAppState(
      WORKSPACE_ID,
      makeChecklist([{ actual: { completionDate: '2025-05-01' } }]),
    );
    const result = completeTask(state, LOC0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const task = getTasks(result.value.workspaces[0].todoFile.projects[0] as any)[0];
    expect(task.actual).toEqual({ startDate: '2025-05-01', completionDate: '2025-06-15' });
  });

  test('records actual duration when provided', () => {
    const state = checklistState(1);
    const result = completeTask(state, LOC0, { duration: { amount: 3, unit: 'hrs' } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const task = getTasks(result.value.workspaces[0].todoFile.projects[0] as any)[0];
    expect(task.actual?.duration).toEqual({ amount: 3, unit: 'hrs' });
  });

  test('records duration alongside start date', () => {
    const state = makeAppState(
      WORKSPACE_ID,
      makeChecklist([{ actual: { completionDate: '2025-04-01' } }]),
    );
    const result = completeTask(state, LOC0, { duration: { amount: 1, unit: 'days' } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const task = getTasks(result.value.workspaces[0].todoFile.projects[0] as any)[0];
    expect(task.actual).toEqual({
      startDate: '2025-04-01',
      completionDate: '2025-06-15',
      duration: { amount: 1, unit: 'days' },
    });
  });

  test('completing an already-completed task overwrites the actual token', () => {
    const state = makeAppState(
      WORKSPACE_ID,
      makeChecklist([{ completed: true, actual: { completionDate: '2025-01-01' } }]),
    );
    const result = completeTask(state, LOC0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const task = getTasks(result.value.workspaces[0].todoFile.projects[0] as any)[0];
    expect(task.completed).toBe(true);
    // The old completionDate becomes the startDate, today becomes the new completionDate
    expect(task.actual).toEqual({ startDate: '2025-01-01', completionDate: '2025-06-15' });
  });
});

describe('uncompleteTask', () => {
  test('marks completed task as incomplete', () => {
    const state = makeAppState(
      WORKSPACE_ID,
      makeChecklist([{ completed: true, actual: { completionDate: '2025-01-01' } }]),
    );
    const result = uncompleteTask(state, LOC0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const task = getTasks(result.value.workspaces[0].todoFile.projects[0] as any)[0];
    expect(task.completed).toBe(false);
  });

  test('preserves existing actual token', () => {
    const state = makeAppState(
      WORKSPACE_ID,
      makeChecklist([{ completed: true, actual: { completionDate: '2025-01-01' } }]),
    );
    const result = uncompleteTask(state, LOC0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const task = getTasks(result.value.workspaces[0].todoFile.projects[0] as any)[0];
    expect(task.actual).toEqual({ completionDate: '2025-01-01' });
  });

  test('uncompleting an already-incomplete task is a no-op for completed flag', () => {
    const state = makeAppState(WORKSPACE_ID, makeChecklist([{ completed: false }]));
    const result = uncompleteTask(state, LOC0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const task = getTasks(result.value.workspaces[0].todoFile.projects[0] as any)[0];
    expect(task.completed).toBe(false);
  });
});

describe('moveTask', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-07-01T12:00:00'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('moves task between checklist projects', () => {
    const tf: TodoFile = {
      frontmatter: EMPTY_FRONTMATTER,
      preamble: [],
      projects: [
        {
          name: 'P1',
          layout: 'checklist',
          frontmatter: EMPTY_FRONTMATTER,
          blocks: [{ type: 'task', task: makeTask({ id: 't1', text: 'Task A' }) }],
        },
        { name: 'P2', layout: 'checklist', frontmatter: EMPTY_FRONTMATTER, blocks: [] },
      ],
    };
    const state = makeAppState(WORKSPACE_ID, tf);
    const from = { workspaceId: WORKSPACE_ID, projectIndex: 0, taskIndex: 0 };
    const to = { workspaceId: WORKSPACE_ID, projectIndex: 1, taskIndex: 0 };
    const result = moveTask(state, from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const p1 = getTasks(result.value.workspaces[0].todoFile.projects[0] as any);
    const p2 = getTasks(result.value.workspaces[0].todoFile.projects[1] as any);
    expect(p1).toHaveLength(0);
    expect(p2).toHaveLength(1);
    expect(p2[0].text).toBe('Task A');
  });

  test('sets start date when moving kanban task out of first column', () => {
    const state = makeAppState(
      WORKSPACE_ID,
      makeKanban([
        { name: 'Todo', tasks: [{ text: 'New feature' }] },
        { name: 'In Progress' },
        { name: 'Done' },
      ]),
    );
    const from = { workspaceId: WORKSPACE_ID, projectIndex: 0, columnIndex: 0, taskIndex: 0 };
    const to = { workspaceId: WORKSPACE_ID, projectIndex: 0, columnIndex: 1, taskIndex: 0 };
    const result = moveTask(state, from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const col1 = getColumns(result.value.workspaces[0].todoFile.projects[0] as any)[1];
    expect(getColumnTasks(col1)[0].actual).toEqual({ completionDate: '2025-07-01' });
  });

  test('does not overwrite existing actual when moving out of first column', () => {
    const state = makeAppState(
      WORKSPACE_ID,
      makeKanban([
        { name: 'Todo', tasks: [{ text: 'T', actual: { completionDate: '2025-06-01' } }] },
        { name: 'In Progress' },
        { name: 'Done' },
      ]),
    );
    const from = { workspaceId: WORKSPACE_ID, projectIndex: 0, columnIndex: 0, taskIndex: 0 };
    const to = { workspaceId: WORKSPACE_ID, projectIndex: 0, columnIndex: 1, taskIndex: 0 };
    const result = moveTask(state, from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const col1 = getColumns(result.value.workspaces[0].todoFile.projects[0] as any)[1];
    expect(getColumnTasks(col1)[0].actual).toEqual({ completionDate: '2025-06-01' });
  });

  test('auto-completes task when entering last kanban column', () => {
    const state = makeAppState(
      WORKSPACE_ID,
      makeKanban([
        { name: 'Todo' },
        { name: 'In Progress', tasks: [{ text: 'WIP task', actual: { completionDate: '2025-06-15' } }] },
        { name: 'Done' },
      ]),
    );
    const from = { workspaceId: WORKSPACE_ID, projectIndex: 0, columnIndex: 1, taskIndex: 0 };
    const to = { workspaceId: WORKSPACE_ID, projectIndex: 0, columnIndex: 2, taskIndex: 0 };
    const result = moveTask(state, from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const col2 = getColumns(result.value.workspaces[0].todoFile.projects[0] as any)[2];
    expect(getColumnTasks(col2)[0].completed).toBe(true);
    expect(getColumnTasks(col2)[0].actual).toEqual({ startDate: '2025-06-15', completionDate: '2025-07-01' });
  });

  test('auto-completes without start date when entering last column with no prior actual', () => {
    const state = makeAppState(
      WORKSPACE_ID,
      makeKanban([
        { name: 'Todo' },
        { name: 'In Progress', tasks: [{ text: 'WIP' }] },
        { name: 'Done' },
      ]),
    );
    const from = { workspaceId: WORKSPACE_ID, projectIndex: 0, columnIndex: 1, taskIndex: 0 };
    const to = { workspaceId: WORKSPACE_ID, projectIndex: 0, columnIndex: 2, taskIndex: 0 };
    const result = moveTask(state, from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const col2 = getColumns(result.value.workspaces[0].todoFile.projects[0] as any)[2];
    expect(getColumnTasks(col2)[0].completed).toBe(true);
    expect(getColumnTasks(col2)[0].actual).toEqual({ completionDate: '2025-07-01' });
  });

  test('reorders within same list when from and to share list', () => {
    const state = checklistState(3);
    const from = { workspaceId: WORKSPACE_ID, projectIndex: 0, taskIndex: 0 };
    const to = { workspaceId: WORKSPACE_ID, projectIndex: 0, taskIndex: 2 };
    const result = moveTask(state, from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tasks = getTasks(result.value.workspaces[0].todoFile.projects[0] as any);
    expect(tasks.map((t: any) => t.text)).toEqual(['Task 2', 'Task 3', 'Task 1']);
  });

  test('moving kanban task within same column is a no-op reorder', () => {
    const state = makeAppState(
      WORKSPACE_ID,
      makeKanban([
        { name: 'Todo', tasks: [{ text: 'Task A' }, { text: 'Task B' }] },
        { name: 'Done' },
      ]),
    );
    const from = { workspaceId: WORKSPACE_ID, projectIndex: 0, columnIndex: 0, taskIndex: 0 };
    const to = { workspaceId: WORKSPACE_ID, projectIndex: 0, columnIndex: 0, taskIndex: 1 };
    const result = moveTask(state, from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const col0 = getColumns(result.value.workspaces[0].todoFile.projects[0] as any)[0];
    expect(getColumnTasks(col0).map((t: any) => t.text)).toEqual(['Task B', 'Task A']);
  });

  test('moves task between workspaces', () => {
    const state = makeMultiWorkspaceState([
      {
        id: 'ws1',
        todoFile: {
          frontmatter: EMPTY_FRONTMATTER,
          preamble: [],
          projects: [
            {
              name: 'P1',
              layout: 'checklist',
              frontmatter: EMPTY_FRONTMATTER,
              blocks: [{ type: 'task', task: makeTask({ id: 't1', text: 'Cross-WS task' }) }],
            },
          ],
        },
      },
      {
        id: 'ws2',
        todoFile: {
          frontmatter: EMPTY_FRONTMATTER,
          preamble: [],
          projects: [{ name: 'P2', layout: 'checklist', frontmatter: EMPTY_FRONTMATTER, blocks: [] }],
        },
      },
    ]);
    const from = { workspaceId: 'ws1', projectIndex: 0, taskIndex: 0 };
    const to = { workspaceId: 'ws2', projectIndex: 0, taskIndex: 0 };
    const result = moveTask(state, from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ws1Tasks = getTasks(result.value.workspaces[0].todoFile.projects[0] as any);
    const ws2Tasks = getTasks(result.value.workspaces[1].todoFile.projects[0] as any);
    expect(ws1Tasks).toHaveLength(0);
    expect(ws2Tasks).toHaveLength(1);
    expect(ws2Tasks[0].text).toBe('Cross-WS task');
  });
});

describe('reorderTask', () => {
  test('moves task to new position', () => {
    const state = checklistState(3);
    const result = reorderTask(state, LOC0, 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tasks = getTasks(result.value.workspaces[0].todoFile.projects[0] as any);
    expect(tasks.map((t: any) => t.text)).toEqual(['Task 2', 'Task 3', 'Task 1']);
  });

  test('returns error for out-of-bounds newIndex', () => {
    const state = checklistState(2);
    const result = reorderTask(state, LOC0, 5);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INDEX_OUT_OF_BOUNDS');
  });
});

describe('addSubtask', () => {
  test('adds subtask to parent task', () => {
    const state = checklistState(1);
    const result = addSubtask(state, LOC0, { text: 'Sub task' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const task = getTasks(result.value.workspaces[0].todoFile.projects[0] as any)[0];
    expect(task.subtasks).toHaveLength(1);
    expect(task.subtasks[0].text).toBe('Sub task');
  });

  test('does not mutate original task', () => {
    const state = checklistState(1);
    const originalSubtasks = getTasks(state.workspaces[0].todoFile.projects[0] as any)[0].subtasks;
    addSubtask(state, LOC0, { text: 'Sub' });
    expect(originalSubtasks).toHaveLength(0);
  });
});

describe('updateSubtask', () => {
  test('updates subtask text', () => {
    const state = makeAppState(
      WORKSPACE_ID,
      makeChecklist([
        { subtasks: [makeTask({ id: 'sub-1', text: 'Original sub' })] },
      ]),
    );
    const loc = { workspaceId: WORKSPACE_ID, projectIndex: 0, taskIndex: 0, subtaskIndex: 0 };
    const result = updateSubtask(state, loc, { text: 'Updated sub' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const subtask = getTasks(result.value.workspaces[0].todoFile.projects[0] as any)[0].subtasks[0];
    expect(subtask.text).toBe('Updated sub');
  });

  test('returns error for invalid subtask index', () => {
    const state = checklistState(1);
    const loc = { workspaceId: WORKSPACE_ID, projectIndex: 0, taskIndex: 0, subtaskIndex: 5 };
    const result = updateSubtask(state, loc, { text: 'x' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('SUBTASK_NOT_FOUND');
  });
});

describe('deleteSubtask', () => {
  test('removes subtask', () => {
    const state = makeAppState(
      WORKSPACE_ID,
      makeChecklist([
        {
          subtasks: [
            makeTask({ id: 'sub-1', text: 'Sub 1' }),
            makeTask({ id: 'sub-2', text: 'Sub 2' }),
          ],
        },
      ]),
    );
    const loc = { workspaceId: WORKSPACE_ID, projectIndex: 0, taskIndex: 0, subtaskIndex: 0 };
    const result = deleteSubtask(state, loc);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const subtasks = getTasks(result.value.workspaces[0].todoFile.projects[0] as any)[0].subtasks;
    expect(subtasks).toHaveLength(1);
    expect(subtasks[0].text).toBe('Sub 2');
  });
});

describe('composition: addTask → completeTask', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-09-01T12:00:00'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('add then complete produces correct & token', () => {
    let state = makeAppState(WORKSPACE_ID, { frontmatter: EMPTY_FRONTMATTER, preamble: [], projects: [{ name: 'P', layout: 'checklist', frontmatter: EMPTY_FRONTMATTER, blocks: [] }] });
    const addResult = addTask(state, WORKSPACE_ID, 0, undefined, { text: 'Fresh task' });
    expect(addResult.ok).toBe(true);
    if (!addResult.ok) return;
    state = addResult.value;

    const completeResult = completeTask(state, LOC0);
    expect(completeResult.ok).toBe(true);
    if (!completeResult.ok) return;
    const task = getTasks(completeResult.value.workspaces[0].todoFile.projects[0] as any)[0];
    expect(task.completed).toBe(true);
    expect(task.actual).toEqual({ completionDate: '2025-09-01' });
  });
});

describe('round-trip: operation → serialize → parse', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-10-15T12:00:00'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('completed task round-trips through serializer', () => {
    let state = makeAppState(WORKSPACE_ID, { frontmatter: EMPTY_FRONTMATTER, preamble: [], projects: [{ name: 'P', layout: 'checklist', frontmatter: EMPTY_FRONTMATTER, blocks: [] }] });
    const addResult = addTask(state, WORKSPACE_ID, 0, undefined, {
      text: 'Round trip',
      effort: { amount: 1, unit: 'hrs' },
    });
    expect(addResult.ok).toBe(true);
    if (!addResult.ok) return;

    const completeResult = completeTask(addResult.value, LOC0);
    expect(completeResult.ok).toBe(true);
    if (!completeResult.ok) return;

    const serialized = serialize(completeResult.value.workspaces[0].todoFile);
    const reparsed = parse(serialized).file;

    // After re-parsing, ensureInbox inserts an Inbox project at index 0,
    // so the 'P' project is at index 1.
    const pProject = reparsed.projects.find(p => p.name === 'P') as any;
    const task = getTasks(pProject)[0];
    expect(task.completed).toBe(true);
    expect(task.actual?.completionDate).toBe('2025-10-15');
    expect(task.text).toBe('Round trip');
  });

  // Regression: rebuildBlocks used to reattach a mutated task's preceding
  // content only by reference identity or `^id`. completeTask always builds
  // a new task object, so a task with no `^id` had nothing to anchor to and
  // its project description, headings, and sibling tasks were relocated to
  // the end of the file — see the plan's "The blocker" section for the
  // repro this codifies.
  test('completing a task with no ^id leaves the project description, headings, and sibling tasks in position', () => {
    const source = [
      '# Home & Errands',
      '',
      'Weekly errands and household tasks.',
      '',
      '- [ ] Buy groceries !2025-12-15 @errands $3 #shopping',
      '- [ ] Pay electricity bill !2025-12-20 @online $4 #bills',
      '',
      '# Health & Fitness',
      '',
      '## This Week',
      '',
      '- [ ] Morning run @outside',
    ].join('\n');

    const parsed = parse(source).file;
    const homeIndex = parsed.projects.findIndex(p => p.name === 'Home & Errands');
    const state = makeAppState(WORKSPACE_ID, parsed);

    const result = completeTask(state, { workspaceId: WORKSPACE_ID, projectIndex: homeIndex, taskIndex: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const serialized = serialize(result.value.workspaces[0].todoFile);
    const lines = serialized.split('\n');

    const headingIndex = lines.indexOf('# Home & Errands');
    const descIndex = lines.indexOf('Weekly errands and household tasks.');
    expect(headingIndex).toBeGreaterThanOrEqual(0);
    expect(descIndex).toBe(headingIndex + 2); // blank line, then description
    expect(lines[descIndex + 2]).toMatch(/^- \[x\] Buy groceries/); // blank line, then the completed task
    expect(lines[descIndex + 3]).toMatch(/^- \[ \] Pay electricity bill/);

    // The second project's heading, sub-heading and task are untouched and
    // still follow the first project, not hoisted above it.
    const secondHeadingIndex = lines.indexOf('# Health & Fitness');
    expect(secondHeadingIndex).toBeGreaterThan(descIndex + 3);
    expect(lines).toContain('## This Week');
    expect(lines).toContain('- [ ] Morning run @outside');
  });
});

describe('kanban flow: move through all columns', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-11-01T12:00:00'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('full kanban flow records start date and completion date', () => {
    const state = makeAppState(
      WORKSPACE_ID,
      makeKanban([
        { name: 'Todo', tasks: [{ text: 'Feature' }] },
        { name: 'In Progress' },
        { name: 'Done' },
      ]),
    );

    // Move from Todo → In Progress
    const step1 = moveTask(
      state,
      { workspaceId: WORKSPACE_ID, projectIndex: 0, columnIndex: 0, taskIndex: 0 },
      { workspaceId: WORKSPACE_ID, projectIndex: 0, columnIndex: 1, taskIndex: 0 },
    );
    expect(step1.ok).toBe(true);
    if (!step1.ok) return;
    const inProgress = getColumnTasks(getColumns(step1.value.workspaces[0].todoFile.projects[0] as any)[1])[0];
    expect(inProgress.actual).toEqual({ completionDate: '2025-11-01' });
    expect(inProgress.completed).toBe(false);

    // Advance time then move to Done
    vi.setSystemTime(new Date('2025-11-15T12:00:00'));
    const step2 = moveTask(
      step1.value,
      { workspaceId: WORKSPACE_ID, projectIndex: 0, columnIndex: 1, taskIndex: 0 },
      { workspaceId: WORKSPACE_ID, projectIndex: 0, columnIndex: 2, taskIndex: 0 },
    );
    expect(step2.ok).toBe(true);
    if (!step2.ok) return;
    const done = getColumnTasks(getColumns(step2.value.workspaces[0].todoFile.projects[0] as any)[2])[0];
    expect(done.completed).toBe(true);
    expect(done.actual).toEqual({ startDate: '2025-11-01', completionDate: '2025-11-15' });
  });
});
