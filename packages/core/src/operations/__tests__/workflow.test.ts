import { completeTask, uncompleteTask, cancelTask, moveTask, updateTask } from '../taskOps';
import { getColumns, getColumnTasks } from '../../model/accessors';
import type { AppState, KanbanProject, Task, Tag } from '../../model/types';
import { nextOccurrence } from '../recurrence';
import { makeKanban, makeAppState, makeTask, WORKSPACE_ID, EMPTY_FRONTMATTER } from './helpers';

// A 3-column board [Todo, Doing, Done] with an optional `on-complete`.
function board(onComplete: string | undefined, columns: Array<{ name: string; tasks?: Partial<Task>[] }>): AppState {
  const todoFile = makeKanban(columns);
  const project = todoFile.projects[0] as KanbanProject;
  const recognized: Record<string, unknown> = {};
  if (onComplete !== undefined) recognized['on-complete'] = onComplete;
  project.frontmatter = { ...EMPTY_FRONTMATTER, recognized, present: onComplete !== undefined };
  return makeAppState(WORKSPACE_ID, todoFile);
}

const COLUMNS = [
  { name: 'Todo', tasks: [{ text: 'A', blockId: 'a' }, { text: 'B', blockId: 'b' }] },
  { name: 'Doing', tasks: [{ text: 'C', blockId: 'c' }] },
  { name: 'Done', tasks: [{ text: 'Old', blockId: 'old', completed: true, checkbox: { state: 'done' as const, marker: 'x' } }] },
];

function texts(state: AppState, column: number): string[] {
  const project = state.workspaces[0].todoFile.projects[0] as KanbanProject;
  return getColumnTasks(getColumns(project)[column]).map(t => t.text);
}
function ref(taskId: string) {
  return { workspaceId: WORKSPACE_ID, taskId };
}
function ok<T>(r: { ok: boolean; value?: T; error?: unknown }): T {
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.value as T;
}

describe('on-complete: default (key absent) is the last column', () => {
  test('completeTask moves to the top of the last column', () => {
    const next = ok(completeTask(board(undefined, COLUMNS), ref('a')));
    expect(texts(next, 0)).toEqual(['B']);
    expect(texts(next, 2)).toEqual(['A', 'Old']);
  });

  test('cancelTask moves to the top of the last column without an & token', () => {
    const next = ok(cancelTask(board(undefined, COLUMNS), ref('a')));
    expect(texts(next, 2)).toEqual(['A', 'Old']);
    const moved = getColumnTasks(getColumns(next.workspaces[0].todoFile.projects[0] as KanbanProject)[2])[0];
    expect(moved.checkbox.state).toBe('cancelled');
    expect(moved.actual).toBeUndefined();
  });

  test('moveTask into the last column completes an open task (unchanged behavior)', () => {
    const state = board(undefined, COLUMNS);
    const next = ok(moveTask(state, ref('a'), { workspaceId: WORKSPACE_ID, projectIndex: 0, columnIndex: 2, taskIndex: 1 }));
    const project = next.workspaces[0].todoFile.projects[0] as KanbanProject;
    const entered = getColumnTasks(getColumns(project)[2])[1];
    expect(entered.text).toBe('A');
    expect(entered.checkbox.state).toBe('done');
  });

  test('moveTask into the completion column leaves a cancelled task cancelled', () => {
    const state = board(undefined, [
      { name: 'Todo', tasks: [{ text: 'X', blockId: 'x', checkbox: { state: 'cancelled', marker: '-' } }] },
      { name: 'Done' },
    ]);
    const next = ok(moveTask(state, ref('x'), { workspaceId: WORKSPACE_ID, projectIndex: 0, columnIndex: 1, taskIndex: 0 }));
    const project = next.workspaces[0].todoFile.projects[0] as KanbanProject;
    expect(getColumnTasks(getColumns(project)[1])[0].checkbox.state).toBe('cancelled');
  });

  test('uncompleteTask in the completion column moves to the top of the first column', () => {
    const next = ok(uncompleteTask(board(undefined, COLUMNS), ref('old')));
    expect(texts(next, 0)).toEqual(['Old', 'A', 'B']);
    expect(texts(next, 2)).toEqual([]);
  });

  test('uncompleteTask outside the completion column stays in place', () => {
    const state = board(undefined, [
      { name: 'Todo' },
      { name: 'Doing', tasks: [{ text: 'C', blockId: 'c', completed: true, checkbox: { state: 'done', marker: 'x' } }] },
      { name: 'Done' },
    ]);
    const next = ok(uncompleteTask(state, ref('c')));
    expect(texts(next, 1)).toEqual(['C']);
  });

  test('completing a task already in the completion column leaves it in place', () => {
    const state = board(undefined, [
      { name: 'Todo' },
      { name: 'Done', tasks: [{ text: 'P', blockId: 'p' }, { text: 'Q', blockId: 'q' }] },
    ]);
    const next = ok(completeTask(state, ref('q')));
    expect(texts(next, 1)).toEqual(['P', 'Q']);
  });
});

describe('on-complete: explicit column', () => {
  test('completion targets the named column, not the last', () => {
    const state = board('Doing', COLUMNS);
    const next = ok(completeTask(state, ref('a')));
    expect(texts(next, 1)).toEqual(['A', 'C']);
  });

  test('name matching is case-insensitive', () => {
    const next = ok(completeTask(board('doing', COLUMNS), ref('a')));
    expect(texts(next, 1)).toEqual(['A', 'C']);
  });

  test('entering the last column no longer completes when it is not the completion column', () => {
    const state = board('Doing', COLUMNS);
    const next = ok(moveTask(state, ref('a'), { workspaceId: WORKSPACE_ID, projectIndex: 0, columnIndex: 2, taskIndex: 0 }));
    const project = next.workspaces[0].todoFile.projects[0] as KanbanProject;
    expect(getColumnTasks(getColumns(project)[2])[0].checkbox.state).toBe('open');
  });

  test('moving into the named column completes the task', () => {
    const state = board('Doing', COLUMNS);
    const next = ok(moveTask(state, ref('a'), { workspaceId: WORKSPACE_ID, projectIndex: 0, columnIndex: 1, taskIndex: 0 }));
    const project = next.workspaces[0].todoFile.projects[0] as KanbanProject;
    expect(getColumnTasks(getColumns(project)[1])[0].checkbox.state).toBe('done');
  });

  test('uncomplete from the named column returns to the first column', () => {
    const state = board('Doing', [
      { name: 'Todo', tasks: [{ text: 'A', blockId: 'a' }] },
      { name: 'Doing', tasks: [{ text: 'C', blockId: 'c', completed: true, checkbox: { state: 'done', marker: 'x' } }] },
      { name: 'Done' },
    ]);
    const next = ok(uncompleteTask(state, ref('c')));
    expect(texts(next, 0)).toEqual(['C', 'A']);
  });
});

describe('cancelling with an explicit on-complete column', () => {
  test('a cancelled task moves to the named column, not the last', () => {
    const next = ok(cancelTask(board('Doing', COLUMNS), ref('a')));
    expect(texts(next, 1)).toEqual(['A', 'C']);
    expect(texts(next, 2)).toEqual(['Old']);
  });

  test('a cancelled task already in the completion column stays put', () => {
    const state = board('Doing', COLUMNS);
    const next = ok(cancelTask(state, ref('c')));
    expect(texts(next, 1)).toEqual(['C']);
  });
});

describe('on-complete: none', () => {
  test('completion and cancellation happen in place', () => {
    const state = board('none', COLUMNS);
    expect(texts(ok(completeTask(state, ref('a'))), 0)).toEqual(['A', 'B']);
    expect(texts(ok(cancelTask(state, ref('a'))), 0)).toEqual(['A', 'B']);
  });

  test('entering the last column does not complete', () => {
    const state = board('none', COLUMNS);
    const next = ok(moveTask(state, ref('a'), { workspaceId: WORKSPACE_ID, projectIndex: 0, columnIndex: 2, taskIndex: 0 }));
    const project = next.workspaces[0].todoFile.projects[0] as KanbanProject;
    expect(getColumnTasks(getColumns(project)[2])[0].checkbox.state).toBe('open');
  });

  test('the start date is still recorded on leaving the first column', () => {
    const state = board('none', COLUMNS);
    const next = ok(moveTask(state, ref('a'), { workspaceId: WORKSPACE_ID, projectIndex: 0, columnIndex: 1, taskIndex: 0 }));
    const project = next.workspaces[0].todoFile.projects[0] as KanbanProject;
    expect(getColumnTasks(getColumns(project)[1])[0].actual).toBeDefined();
  });
});

describe('on-complete naming a column missing from columns', () => {
  test('the rule is off — it does not fall back to the last column', () => {
    const state = board('Archive', COLUMNS);
    expect(texts(ok(completeTask(state, ref('a'))), 0)).toEqual(['A', 'B']);
    const next = ok(moveTask(state, ref('a'), { workspaceId: WORKSPACE_ID, projectIndex: 0, columnIndex: 2, taskIndex: 0 }));
    const project = next.workspaces[0].todoFile.projects[0] as KanbanProject;
    expect(getColumnTasks(getColumns(project)[2])[0].checkbox.state).toBe('open');
  });
});

describe('recurring tasks', () => {
  const every = (rule: string): Tag => ({ type: 'nested', key: 'every', value: rule });

  test('the completed instance moves to the completion column; the new open instance takes its old position', () => {
    const state = board(undefined, [
      { name: 'Todo', tasks: [{ text: 'first', blockId: 'f' }, { text: 'water', blockId: 'w', dueDate: '2026-05-01', tags: [every('weekly')] }, { text: 'last', blockId: 'l' }] },
      { name: 'Done' },
    ]);
    const next = ok(completeTask(state, ref('w')));
    const project = next.workspaces[0].todoFile.projects[0] as KanbanProject;
    const [todo, done] = getColumns(project).map(getColumnTasks);

    expect(todo.map(t => t.text)).toEqual(['first', 'water', 'last']);
    expect(todo[1]).toMatchObject({ dueDate: '2026-05-08', checkbox: { state: 'open' } });
    expect(todo[1].actual).toBeUndefined();
    expect(todo[1].blockId).toBeDefined();
    expect(todo[1].blockId).not.toBe('w');
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ blockId: 'w', checkbox: { state: 'done' } });
  });

  test('in a checklist the new instance follows the completed one', () => {
    const state = makeAppState(WORKSPACE_ID, {
      frontmatter: EMPTY_FRONTMATTER,
      preamble: [],
      projects: [
        {
          layout: 'checklist',
          name: 'P',
          frontmatter: EMPTY_FRONTMATTER,
          blocks: [{ type: 'task', task: makeTask({ id: 't', text: 'daily', blockId: 'd', dueDate: '2026-05-01', tags: [every('daily')] }) }],
        },
      ],
    });
    const next = ok(completeTask(state, ref('d')));
    const project = next.workspaces[0].todoFile.projects[0];
    const tasks = project.layout === 'checklist' ? project.blocks.filter(b => b.type === 'task').map(b => (b as { task: Task }).task) : [];
    expect(tasks.map(t => t.checkbox.state)).toEqual(['done', 'open']);
    expect(tasks[1].dueDate).toBe('2026-05-02');
  });

  test('the rule name matches case-insensitively, like a weekday', () => {
    expect(nextOccurrence('Daily', '2026-05-01')).toBe('2026-05-02');
    expect(nextOccurrence('Monday', '2026-05-01')).toBe('2026-05-04');
    expect(nextOccurrence('2W', '2026-05-01')).toBe('2026-05-15');
  });

  test('a monthly task clamps at month end and each instance is computed from the last', () => {
    expect(nextOccurrence('monthly', '2026-01-31')).toBe('2026-02-28');
    // Documented limitation: the clamp is not undone.
    expect(nextOccurrence('monthly', '2026-02-28')).toBe('2026-03-28');
  });

  test('an undated recurring task spawns a copy due at the next occurrence from today', () => {
    const state = board(undefined, [
      { name: 'Todo', tasks: [{ text: 'stretch', blockId: 'st', tags: [every('daily')] }] },
      { name: 'Done' },
    ]);
    const next = ok(completeTask(state, ref('st')));
    const project = next.workspaces[0].todoFile.projects[0] as KanbanProject;
    const [todo, done] = getColumns(project).map(getColumnTasks);
    expect(done.map(t => t.text)).toEqual(['stretch']);
    expect(todo).toHaveLength(1);
    expect(todo[0].dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(todo[0].dueDate! > new Date().toISOString().slice(0, 10)).toBe(true);
  });

  test('a non-recurring or already-done task spawns nothing', () => {
    const state = board(undefined, [{ name: 'Todo', tasks: [{ text: 'once', blockId: 'o' }] }, { name: 'Done' }]);
    const next = ok(completeTask(state, ref('o')));
    expect(texts(next, 0)).toEqual([]);
  });
});

describe('subtasks', () => {
  test('subtasks travel with their parent', () => {
    const state = board(undefined, [
      { name: 'Todo', tasks: [{ text: 'P', blockId: 'p', subtasks: [makeTask({ id: 's1', text: 'S1', blockId: 's1' })] }] },
      { name: 'Done' },
    ]);
    const next = ok(completeTask(state, ref('p')));
    const project = next.workspaces[0].todoFile.projects[0] as KanbanProject;
    const moved = getColumnTasks(getColumns(project)[1])[0];
    expect(moved.subtasks.map(s => s.text)).toEqual(['S1']);
  });

  test('a subtask ^id is completed in place; it never changes column', () => {
    const state = board(undefined, [
      { name: 'Todo', tasks: [{ text: 'P', blockId: 'p', subtasks: [makeTask({ id: 's1', text: 'S1', blockId: 's1' })] }] },
      { name: 'Done' },
    ]);
    const next = ok(completeTask(state, ref('s1')));
    expect(texts(next, 0)).toEqual(['P']);
    const project = next.workspaces[0].todoFile.projects[0] as KanbanProject;
    expect(getColumnTasks(getColumns(project)[0])[0].subtasks[0].checkbox.state).toBe('done');
  });
});

describe('updateTask blockId', () => {
  test('sets a valid, unique id', () => {
    const state = board(undefined, [{ name: 'Todo', tasks: [{ text: 'A' }] }]);
    const next = ok(updateTask(state, { workspaceId: WORKSPACE_ID, projectIndex: 0, columnIndex: 0, taskIndex: 0 }, { blockId: 'abc-1' }));
    const project = next.workspaces[0].todoFile.projects[0] as KanbanProject;
    expect(getColumnTasks(getColumns(project)[0])[0].blockId).toBe('abc-1');
  });

  test('rejects a bad charset and a duplicate', () => {
    const state = board(undefined, [{ name: 'Todo', tasks: [{ text: 'A' }, { text: 'B', blockId: 'taken' }] }]);
    const loc = { workspaceId: WORKSPACE_ID, projectIndex: 0, columnIndex: 0, taskIndex: 0 };
    expect(updateTask(state, loc, { blockId: 'no spaces' })).toMatchObject({ ok: false, error: { code: 'INVALID_BLOCK_ID' } });
    expect(updateTask(state, loc, { blockId: 'taken' })).toMatchObject({ ok: false, error: { code: 'DUPLICATE_TASK_ID' } });
  });
});
