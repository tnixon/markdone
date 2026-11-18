import type { AppState, KanbanProject } from '../../model/types';
import { addTask, assignTaskIds } from '../taskOps';
import { resolveTaskRef, resolveSubtaskRef } from '../utils';
import { getTasks, getColumns, getColumnTasks } from '../../model/accessors';
import { makeChecklist, makeKanban, makeAppState, makeTask, WORKSPACE_ID, newTask, EMPTY_FRONTMATTER } from './helpers';

const BLOCK_ID_RE = /^[a-z0-9-]{1,64}$/;

describe('resolveTaskRef', () => {
  test('passes a TaskLocation through unchanged', () => {
    const state = makeAppState(WORKSPACE_ID, makeChecklist([{}, {}]));
    const location = { workspaceId: WORKSPACE_ID, projectIndex: 0, taskIndex: 1 };
    const result = resolveTaskRef(state, location);
    expect(result).toEqual({ ok: true, value: location });
  });

  test('resolves a TaskAddress to the matching checklist task', () => {
    const state = makeAppState(
      WORKSPACE_ID,
      makeChecklist([{ blockId: 'abc' }, { blockId: 'def' }]),
    );
    const result = resolveTaskRef(state, { workspaceId: WORKSPACE_ID, taskId: 'def' });
    expect(result).toEqual({
      ok: true,
      value: { workspaceId: WORKSPACE_ID, projectIndex: 0, taskIndex: 1 },
    });
  });

  test('resolves a TaskAddress to the matching kanban task, including columnIndex', () => {
    const state = makeAppState(
      WORKSPACE_ID,
      makeKanban([
        { name: 'Todo', tasks: [{ blockId: 'a1' }] },
        { name: 'Doing', tasks: [{ blockId: 'a2' }, { blockId: 'a3' }] },
      ]),
    );
    const result = resolveTaskRef(state, { workspaceId: WORKSPACE_ID, taskId: 'a3' });
    expect(result).toEqual({
      ok: true,
      value: { workspaceId: WORKSPACE_ID, projectIndex: 0, columnIndex: 1, taskIndex: 1 },
    });
  });

  test('returns TASK_NOT_FOUND when no task has the given id', () => {
    const state = makeAppState(WORKSPACE_ID, makeChecklist([{ blockId: 'abc' }]));
    const result = resolveTaskRef(state, { workspaceId: WORKSPACE_ID, taskId: 'missing' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('TASK_NOT_FOUND');
  });

  test('returns DUPLICATE_TASK_ID rather than guessing when the id is not unique', () => {
    const state = makeAppState(
      WORKSPACE_ID,
      makeKanban([
        { name: 'Todo', tasks: [{ blockId: 'dup' }] },
        { name: 'Doing', tasks: [{ blockId: 'dup' }] },
      ]),
    );
    const result = resolveTaskRef(state, { workspaceId: WORKSPACE_ID, taskId: 'dup' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DUPLICATE_TASK_ID');
  });

  test('returns an error for an unknown workspace', () => {
    const state = makeAppState(WORKSPACE_ID, makeChecklist());
    const result = resolveTaskRef(state, { workspaceId: 'nope', taskId: 'x' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('WORKSPACE_NOT_FOUND');
  });
});

describe('resolveSubtaskRef', () => {
  function stateWithSubtasks() {
    return makeAppState(
      WORKSPACE_ID,
      makeChecklist([
        { blockId: 'parent-1', subtasks: [makeTask({ id: 'sub-1', blockId: 'sub-a' })] },
        { blockId: 'parent-2', subtasks: [makeTask({ id: 'sub-2', blockId: 'sub-b' })] },
      ]),
    );
  }

  test('passes a SubtaskLocation through unchanged', () => {
    const state = stateWithSubtasks();
    const location = { workspaceId: WORKSPACE_ID, projectIndex: 0, taskIndex: 0, subtaskIndex: 0 };
    expect(resolveSubtaskRef(state, location)).toEqual({ ok: true, value: location });
  });

  test('resolves a TaskAddress to the matching subtask, not its parent', () => {
    const state = stateWithSubtasks();
    const result = resolveSubtaskRef(state, { workspaceId: WORKSPACE_ID, taskId: 'sub-b' });
    expect(result).toEqual({
      ok: true,
      value: { workspaceId: WORKSPACE_ID, projectIndex: 0, taskIndex: 1, subtaskIndex: 0 },
    });
  });

  test('returns TASK_NOT_FOUND when the id belongs to a top-level task, not a subtask', () => {
    const state = stateWithSubtasks();
    const result = resolveSubtaskRef(state, { workspaceId: WORKSPACE_ID, taskId: 'parent-1' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('TASK_NOT_FOUND');
  });

  test('returns DUPLICATE_TASK_ID when two subtasks share an id', () => {
    const state = makeAppState(
      WORKSPACE_ID,
      makeChecklist([
        { blockId: 'parent-1', subtasks: [makeTask({ id: 'sub-1', blockId: 'dup' })] },
        { blockId: 'parent-2', subtasks: [makeTask({ id: 'sub-2', blockId: 'dup' })] },
      ]),
    );
    const result = resolveSubtaskRef(state, { workspaceId: WORKSPACE_ID, taskId: 'dup' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DUPLICATE_TASK_ID');
  });
});

describe('addTask assignId option', () => {
  test('assigns a ^id by default', () => {
    const state = makeAppState(WORKSPACE_ID, makeChecklist());
    const result = addTask(state, WORKSPACE_ID, 0, undefined, newTask);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [task] = getTasks(result.value.workspaces[0].todoFile.projects[0] as any);
    expect(task.blockId).toMatch(BLOCK_ID_RE);
  });

  test('assignId: false leaves the task unaddressed', () => {
    const state = makeAppState(WORKSPACE_ID, makeChecklist());
    const result = addTask(state, WORKSPACE_ID, 0, undefined, newTask, false);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [task] = getTasks(result.value.workspaces[0].todoFile.projects[0] as any);
    expect(task.blockId).toBeUndefined();
  });

  test('the assigned id does not collide with an id already in the workspace', () => {
    const state = makeAppState(WORKSPACE_ID, makeChecklist([{ blockId: 'existing-1' }]));
    const result = addTask(state, WORKSPACE_ID, 0, undefined, newTask);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tasks = getTasks(result.value.workspaces[0].todoFile.projects[0] as any);
    expect(tasks[1].blockId).not.toBe('existing-1');
  });
});

describe('assignTaskIds', () => {
  test('assigns ids to checklist tasks lacking one, leaving existing ids alone', () => {
    const state = makeAppState(
      WORKSPACE_ID,
      makeChecklist([{ blockId: 'keep-me' }, {}, {}]),
    );
    const result = assignTaskIds(state, WORKSPACE_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tasks = getTasks(result.value.workspaces[0].todoFile.projects[0] as any);
    expect(tasks[0].blockId).toBe('keep-me');
    expect(tasks[1].blockId).toMatch(BLOCK_ID_RE);
    expect(tasks[2].blockId).toMatch(BLOCK_ID_RE);
    expect(tasks[1].blockId).not.toBe(tasks[2].blockId);
  });

  test('assigns ids inside kanban columns and auxiliary sections, and to subtasks', () => {
    const project: KanbanProject = {
      layout: 'kanban',
      name: 'Board',
      frontmatter: EMPTY_FRONTMATTER,
      preamble: [],
      sections: [
        {
          kind: 'column',
          name: 'Todo',
          blocks: [
            {
              type: 'task',
              task: makeTask({ id: 't1', subtasks: [makeTask({ id: 's1' })] }),
            },
          ],
        },
        { kind: 'auxiliary', name: 'Notes', blocks: [{ type: 'task', task: makeTask({ id: 't2' }) }] },
        { kind: 'opaque', raw: 'Just prose.' },
      ],
    };
    const state = makeAppState(WORKSPACE_ID, { frontmatter: EMPTY_FRONTMATTER, preamble: [], projects: [project] });

    const result = assignTaskIds(state, WORKSPACE_ID);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const updated = result.value.workspaces[0].todoFile.projects[0] as KanbanProject;
    const [todoColumn] = getColumns(updated);
    const [topTask] = getColumnTasks(todoColumn);
    expect(topTask.blockId).toMatch(BLOCK_ID_RE);
    expect(topTask.subtasks[0].blockId).toMatch(BLOCK_ID_RE);

    const auxSection = updated.sections.find(s => s.kind === 'auxiliary');
    expect(auxSection && auxSection.kind === 'auxiliary' && auxSection.blocks[0]).toMatchObject({
      type: 'task',
      task: { blockId: expect.stringMatching(BLOCK_ID_RE) },
    });

    // Opaque content is untouched.
    expect(updated.sections.find(s => s.kind === 'opaque')).toEqual({ kind: 'opaque', raw: 'Just prose.' });
  });

  test('returns an error for an unknown workspace', () => {
    const state: AppState = { workspaces: [], activeScope: 'none' };
    const result = assignTaskIds(state, WORKSPACE_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('WORKSPACE_NOT_FOUND');
  });
});
