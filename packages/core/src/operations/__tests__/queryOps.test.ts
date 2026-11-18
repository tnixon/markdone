import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AppState } from '../../model/types';
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
  slackDays,
} from '../queryOps';
import { getTasks } from '../../model/accessors';
import { makeAppState, makeChecklist, makeKanban, makeMultiWorkspaceState, WORKSPACE_ID } from './helpers';

function stateWithTasks(): AppState {
  return makeAppState(
    WORKSPACE_ID,
    makeChecklist([
      {
        text: 'Overdue task',
        dueDate: '2025-01-01',
        contexts: ['work'],
        tags: [{ type: 'label', name: 'urgent' }],
        value: 4,
        complexity: 2,
      },
      {
        text: 'Future task',
        dueDate: '2025-12-31',
        contexts: ['home'],
        tags: [{ type: 'nested', key: 'priority', value: 'high' }],
        value: 3,
        complexity: 1,
      },
      {
        text: 'No due date',
        contexts: ['work', 'home'],
        tags: [{ type: 'label', name: 'urgent' }],
        value: 5,
        complexity: 5,
      },
      {
        text: 'Completed task',
        dueDate: '2025-01-01',
        completed: true,
        contexts: ['work'],
        effort: { amount: 2, unit: 'hrs' },
        actual: {
          startDate: '2024-12-01',
          completionDate: '2025-01-01',
          duration: { amount: 3, unit: 'hrs' },
        },
      },
    ]),
  );
}

describe('getOverdueTasks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-01T12:00:00'));
  });
  afterEach(() => { vi.useRealTimers(); });

  test('returns incomplete tasks with due date before today', () => {
    const result = getOverdueTasks(stateWithTasks());
    expect(result).toHaveLength(1);
    expect(result[0].task.text).toBe('Overdue task');
  });

  test('excludes completed tasks', () => {
    const result = getOverdueTasks(stateWithTasks());
    expect(result.every(r => !r.task.completed)).toBe(true);
  });

  test('excludes tasks due in the future', () => {
    const result = getOverdueTasks(stateWithTasks());
    expect(result.some(r => r.task.text === 'Future task')).toBe(false);
  });

  test('respects optional asOfDate parameter', () => {
    const result = getOverdueTasks(stateWithTasks(), '2025-12-30');
    expect(result.some(r => r.task.dueDate === '2025-01-01')).toBe(true);
  });

  test('returns location with each task', () => {
    const result = getOverdueTasks(stateWithTasks());
    expect(result[0].location).toMatchObject({
      workspaceId: WORKSPACE_ID,
      projectIndex: 0,
      taskIndex: 0,
    });
  });

  test('searches across multiple workspaces', () => {
    const state = makeMultiWorkspaceState([
      {
        id: 'ws1',
        todoFile: makeChecklist([{ text: 'WS1 overdue', dueDate: '2025-01-01' }]),
      },
      {
        id: 'ws2',
        todoFile: makeChecklist([{ text: 'WS2 overdue', dueDate: '2025-02-01' }]),
      },
    ]);
    const result = getOverdueTasks(state);
    expect(result).toHaveLength(2);
  });
});

describe('getTasksDueInRange', () => {
  test('returns tasks within date range', () => {
    const result = getTasksDueInRange(stateWithTasks(), '2024-01-01', '2025-06-01');
    expect(result.map(r => r.task.text)).toContain('Overdue task');
  });

  test('excludes tasks outside range', () => {
    const result = getTasksDueInRange(stateWithTasks(), '2025-11-01', '2025-12-31');
    expect(result.map(r => r.task.text)).toContain('Future task');
    expect(result.some(r => r.task.text === 'Overdue task')).toBe(false);
  });

  test('excludes completed tasks', () => {
    const result = getTasksDueInRange(stateWithTasks(), '2024-01-01', '2025-12-31');
    expect(result.every(r => !r.task.completed)).toBe(true);
  });

  test('respects inclusive date boundaries', () => {
    const result = getTasksDueInRange(stateWithTasks(), '2025-01-01', '2025-01-01');
    expect(result.map(r => r.task.text)).toContain('Overdue task');
  });
});

describe('getTasksByContext', () => {
  test('returns tasks with matching context', () => {
    const result = getTasksByContext(stateWithTasks(), 'work');
    const texts = result.map(r => r.task.text);
    expect(texts).toContain('Overdue task');
    expect(texts).toContain('No due date');
  });

  test('does not return tasks with different context', () => {
    const result = getTasksByContext(stateWithTasks(), 'phone');
    expect(result).toHaveLength(0);
  });

  test('includes both complete and incomplete tasks', () => {
    const result = getTasksByContext(stateWithTasks(), 'work');
    expect(result.some(r => r.task.completed)).toBe(true);
    expect(result.some(r => !r.task.completed)).toBe(true);
  });

  test('returns tasks from kanban columns', () => {
    const state = makeAppState(
      WORKSPACE_ID,
      makeKanban([
        { name: 'Todo', tasks: [{ text: 'Kanban task', contexts: ['work'] }] },
        { name: 'Done' },
      ]),
    );
    const result = getTasksByContext(state, 'work');
    expect(result).toHaveLength(1);
    expect(result[0].location.columnIndex).toBe(0);
  });
});

describe('getTasksByTag', () => {
  test('returns tasks with matching label tag', () => {
    const result = getTasksByTag(stateWithTasks(), 'urgent');
    expect(result.map(r => r.task.text)).toContain('Overdue task');
    expect(result.map(r => r.task.text)).toContain('No due date');
  });

  test('returns tasks with matching key-value tag key', () => {
    const result = getTasksByTag(stateWithTasks(), 'priority');
    expect(result.map(r => r.task.text)).toContain('Future task');
  });

  test('returns empty array for unknown tag', () => {
    const result = getTasksByTag(stateWithTasks(), 'nonexistent');
    expect(result).toHaveLength(0);
  });
});

describe('getNextActions', () => {
  test('returns highest value/complexity ratio per context', () => {
    const state = makeAppState(
      WORKSPACE_ID,
      makeChecklist([
        { text: 'Low ratio', contexts: ['work'], value: 1, complexity: 5 },
        { text: 'High ratio', contexts: ['work'], value: 5, complexity: 1 },
        { text: 'Medium ratio', contexts: ['work'], value: 3, complexity: 2 },
      ]),
    );
    const result = getNextActions(state);
    expect(result.get('work')?.task.text).toBe('High ratio');
  });

  test('groups tasks without context under __inbox__', () => {
    const state = makeAppState(
      WORKSPACE_ID,
      makeChecklist([{ text: 'Inbox task', value: 5, complexity: 1 }]),
    );
    const result = getNextActions(state);
    expect(result.has('__inbox__')).toBe(true);
    expect(result.get('__inbox__')?.task.text).toBe('Inbox task');
  });

  test('excludes completed tasks', () => {
    const state = makeAppState(
      WORKSPACE_ID,
      makeChecklist([
        { text: 'Done', contexts: ['work'], completed: true, value: 5, complexity: 1 },
        { text: 'Pending', contexts: ['work'], value: 1, complexity: 5 },
      ]),
    );
    const result = getNextActions(state);
    expect(result.get('work')?.task.text).toBe('Pending');
  });

  test('task with multiple contexts appears in each', () => {
    const state = makeAppState(
      WORKSPACE_ID,
      makeChecklist([{ text: 'Multi-ctx', contexts: ['work', 'home'], value: 3, complexity: 1 }]),
    );
    const result = getNextActions(state);
    expect(result.has('work')).toBe(true);
    expect(result.has('home')).toBe(true);
  });
});

describe('getEstimationAccuracy', () => {
  test('computes accuracy stats for tasks with effort and actual duration', () => {
    const stats = getEstimationAccuracy(stateWithTasks());
    expect(stats.count).toBe(1);
    // estimated: 2hrs = 120 min, actual: 3hrs = 180 min, ratio = 1.5
    expect(stats.meanRatio).toBeCloseTo(1.5);
    expect(stats.minRatio).toBeCloseTo(1.5);
    expect(stats.maxRatio).toBeCloseTo(1.5);
  });

  test('returns zero stats when no qualifying tasks', () => {
    const state = makeAppState(WORKSPACE_ID, makeChecklist([{ text: 'No effort' }]));
    const stats = getEstimationAccuracy(state);
    expect(stats.count).toBe(0);
    expect(stats.tasks).toHaveLength(0);
  });

  test('skips tasks where estimated effort is zero minutes', () => {
    // An effort of 0 would produce division by zero; the guard skips such tasks
    const state = makeAppState(
      WORKSPACE_ID,
      makeChecklist([
        {
          completed: true,
          effort: { amount: 0, unit: 'min' },
          actual: { completionDate: '2025-01-01', duration: { amount: 30, unit: 'min' } },
        },
      ]),
    );
    const stats = getEstimationAccuracy(state);
    expect(stats.count).toBe(0);
  });

  test('filters by workspace when specified', () => {
    const state = makeMultiWorkspaceState([
      {
        id: 'ws1',
        todoFile: makeChecklist([
          {
            completed: true,
            effort: { amount: 1, unit: 'hrs' },
            actual: { completionDate: '2025-01-01', duration: { amount: 2, unit: 'hrs' } },
          },
        ]),
      },
      {
        id: 'ws2',
        todoFile: makeChecklist([
          {
            completed: true,
            effort: { amount: 1, unit: 'hrs' },
            actual: { completionDate: '2025-01-01', duration: { amount: 3, unit: 'hrs' } },
          },
        ]),
      },
    ]);
    const stats = getEstimationAccuracy(state, 'ws1');
    expect(stats.count).toBe(1);
    expect(stats.meanRatio).toBeCloseTo(2.0);
  });
});

describe('searchTasks', () => {
  test('finds tasks by description text', () => {
    const result = searchTasks(stateWithTasks(), 'Overdue');
    expect(result).toHaveLength(1);
    expect(result[0].task.text).toBe('Overdue task');
  });

  test('search is case-insensitive', () => {
    const result = searchTasks(stateWithTasks(), 'overdue');
    expect(result).toHaveLength(1);
  });

  test('finds tasks by tag name', () => {
    const result = searchTasks(stateWithTasks(), 'urgent');
    expect(result.map(r => r.task.text)).toContain('Overdue task');
    expect(result.map(r => r.task.text)).toContain('No due date');
  });

  test('returns empty array for no matches', () => {
    const result = searchTasks(stateWithTasks(), 'xyznotfound');
    expect(result).toHaveLength(0);
  });

  test('empty query matches all tasks', () => {
    const result = searchTasks(stateWithTasks(), '');
    expect(result.length).toBeGreaterThan(0);
    // All tasks match because every string includes ''
    const state = stateWithTasks();
    const totalTasks = getTasks(state.workspaces[0].todoFile.projects[0] as any).length;
    expect(result).toHaveLength(totalTasks);
  });

  test('returns location with each result', () => {
    const result = searchTasks(stateWithTasks(), 'Future');
    expect(result[0].location.workspaceId).toBe(WORKSPACE_ID);
    expect(result[0].location.taskIndex).toBe(1);
  });
});

describe('listTasks', () => {
  test('filters by context', () => {
    const result = listTasks(stateWithTasks(), { context: 'home' });
    expect(result.map(r => r.task.text)).toEqual(['Future task', 'No due date']);
  });

  test('filters by tag', () => {
    const result = listTasks(stateWithTasks(), { tag: 'urgent' });
    expect(result.map(r => r.task.text).sort()).toEqual(['No due date', 'Overdue task']);
  });

  test('filters by checkboxState', () => {
    const result = listTasks(stateWithTasks(), { checkboxState: 'done' });
    // "Completed task" is the fixture's only entry with completed: true, but
    // checkbox.state is set independently — the fixture doesn't set it, so
    // filtering by checkboxState correctly finds nothing here.
    expect(result).toEqual([]);
  });

  test('filters by dueBefore/dueAfter (exclusive)', () => {
    expect(listTasks(stateWithTasks(), { dueBefore: '2025-06-01' }).map(r => r.task.text).sort()).toEqual([
      'Completed task',
      'Overdue task',
    ]);
    expect(listTasks(stateWithTasks(), { dueAfter: '2025-06-01' }).map(r => r.task.text)).toEqual(['Future task']);
  });

  test('filters by waiting', () => {
    const state = makeAppState(
      WORKSPACE_ID,
      makeChecklist([
        { text: 'Waiting on design', tags: [{ type: 'nested', key: 'waiting', value: 'dana' }] },
        { text: 'Not waiting' },
      ]),
    );
    expect(listTasks(state, { waiting: true }).map(r => r.task.text)).toEqual(['Waiting on design']);
  });

  test('filters by owner, inherited from project frontmatter', () => {
    const state = makeAppState(WORKSPACE_ID, {
      frontmatter: { raw: '', recognized: {}, unknown: {}, present: false },
      preamble: [],
      projects: [
        {
          layout: 'checklist',
          name: 'P',
          frontmatter: { raw: '', recognized: { owner: 'bob' }, unknown: {}, present: true },
          blocks: [
            { type: 'task', task: { id: 't1', text: 'Owned by bob', checkbox: { state: 'open', marker: ' ' }, completed: false, contexts: [], tags: [], subtasks: [] } },
          ],
        },
      ],
    });
    expect(listTasks(state, { owner: 'bob' })).toHaveLength(1);
    expect(listTasks(state, { owner: 'someone-else' })).toHaveLength(0);
  });

  test('combines a filter with workspace scoping', () => {
    const state = makeMultiWorkspaceState([
      { id: 'ws1', todoFile: makeChecklist([{ text: 'A', contexts: ['work'] }]) },
      { id: 'ws2', todoFile: makeChecklist([{ text: 'B', contexts: ['work'] }]) },
    ]);
    const result = listTasks(state, { workspaceId: 'ws2', context: 'work' });
    expect(result).toHaveLength(1);
    expect(result[0].location.workspaceId).toBe('ws2');
  });
});

describe('getWaitingFor', () => {
  test('returns only open tasks with a #waiting/ tag', () => {
    const state = makeAppState(
      WORKSPACE_ID,
      makeChecklist([
        { text: 'Waiting on design', tags: [{ type: 'nested', key: 'waiting', value: 'dana' }] },
        {
          text: 'Done waiting',
          completed: true,
          checkbox: { state: 'done', marker: 'x' },
          tags: [{ type: 'nested', key: 'waiting', value: 'dana' }],
        },
        { text: 'Not waiting' },
      ]),
    );
    expect(getWaitingFor(state).map(r => r.task.text)).toEqual(['Waiting on design']);
  });
});

describe('getNextActions scoping', () => {
  test('restricts candidates to a given project when scoped', () => {
    const state = makeMultiWorkspaceState([
      { id: 'ws1', todoFile: makeChecklist([{ text: 'A', contexts: ['work'], value: 10 }]) },
      { id: 'ws2', todoFile: makeChecklist([{ text: 'B', contexts: ['work'], value: 1 }]) },
    ]);
    const scoped = getNextActions(state, { workspaceId: 'ws2' });
    expect(scoped.get('work')?.task.text).toBe('B');

    const unscoped = getNextActions(state);
    expect(unscoped.get('work')?.task.text).toBe('A');
  });
});

describe('getEstimationAccuracy bucketing', () => {
  test('buckets by owner and by complexity', () => {
    const state = makeAppState(WORKSPACE_ID, {
      frontmatter: { raw: '', recognized: {}, unknown: {}, present: false },
      preamble: [],
      projects: [
        {
          layout: 'checklist',
          name: 'P',
          frontmatter: { raw: '', recognized: {}, unknown: {}, present: false },
          blocks: [
            {
              type: 'task',
              task: {
                id: 't1',
                text: 'Alice task',
                checkbox: { state: 'done', marker: 'x' },
                completed: true,
                contexts: [],
                tags: [{ type: 'nested', key: 'owner', value: 'alice' }],
                subtasks: [],
                complexity: 3,
                effort: { amount: 1, unit: 'hrs' },
                actual: { completionDate: '2025-01-01', duration: { amount: 2, unit: 'hrs' } },
              },
            },
            {
              type: 'task',
              task: {
                id: 't2',
                text: 'Bob task',
                checkbox: { state: 'done', marker: 'x' },
                completed: true,
                contexts: [],
                tags: [{ type: 'nested', key: 'owner', value: 'bob' }],
                subtasks: [],
                complexity: 3,
                effort: { amount: 1, unit: 'hrs' },
                actual: { completionDate: '2025-01-01', duration: { amount: 1, unit: 'hrs' } },
              },
            },
          ],
        },
      ],
    });

    const stats = getEstimationAccuracy(state);
    expect(stats.count).toBe(2);
    expect(stats.byOwner.alice.meanRatio).toBeCloseTo(2.0);
    expect(stats.byOwner.bob.meanRatio).toBeCloseTo(1.0);
    expect(stats.byComplexity['3'].count).toBe(2);
  });
});

describe('score', () => {
  function makeScoreState() {
    return makeAppState(WORKSPACE_ID, {
      frontmatter: { raw: '', recognized: {}, unknown: {}, present: false },
      preamble: [],
      projects: [
        {
          layout: 'checklist',
          name: 'P',
          frontmatter: { raw: '', recognized: { priority: 2 }, unknown: {}, present: true },
          blocks: [
            {
              type: 'task',
              task: {
                id: 't1',
                text: 'Scored task',
                checkbox: { state: 'open', marker: ' ' },
                completed: false,
                contexts: ['work'],
                tags: [{ type: 'nested', key: 'energy', value: 'high' }],
                subtasks: [],
                value: 5,
                complexity: 3,
                dueDate: '2025-06-04',
                effort: { amount: 1, unit: 'days' },
              },
            },
          ],
        },
      ],
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-06-01T12:00:00'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test('importance scales value by project priority', () => {
    const state = makeScoreState();
    const project = state.workspaces[0].todoFile.projects[0];
    const task = getTasks(project as any)[0];
    const result = score(task, project, state.workspaces[0]);
    expect(result.importance).toBe(10); // value 5 * priority 2
  });

  test('urgency is slack in days when both due date and effort are present', () => {
    const state = makeScoreState();
    const project = state.workspaces[0].todoFile.projects[0];
    const task = getTasks(project as any)[0];
    const result = score(task, project, state.workspaces[0]);
    // due in 3 days, effort 1 day => slack = 3 - 1 = 2
    expect(result.urgency).toBeCloseTo(2);
  });

  test('fit surfaces the raw context/energy/owner signals', () => {
    const state = makeScoreState();
    const project = state.workspaces[0].todoFile.projects[0];
    const task = getTasks(project as any)[0];
    const result = score(task, project, state.workspaces[0]);
    expect(result.fit).toEqual({ contexts: ['work'], energy: 'high', owner: undefined });
  });

  test('risk is undefined with no historical data for the complexity bucket', () => {
    const state = makeScoreState();
    const project = state.workspaces[0].todoFile.projects[0];
    const task = getTasks(project as any)[0];
    const result = score(task, project, state.workspaces[0]);
    expect(result.risk).toBeUndefined();
  });

  test('importance and urgency are undefined without the underlying tokens', () => {
    const task = {
      id: 't2',
      text: 'Bare task',
      checkbox: { state: 'open' as const, marker: ' ' },
      completed: false,
      contexts: [],
      tags: [],
      subtasks: [],
    };
    const state = makeScoreState();
    const project = state.workspaces[0].todoFile.projects[0];
    const result = score(task, project, state.workspaces[0]);
    expect(result.importance).toBeUndefined();
    expect(result.urgency).toBeUndefined();
  });
});

describe('slackDays', () => {
  test('matches score()\'s urgency for the same due date and effort', () => {
    const task = {
      id: 't1',
      text: 'Scored task',
      checkbox: { state: 'open' as const, marker: ' ' },
      completed: false,
      contexts: [],
      tags: [],
      subtasks: [],
      dueDate: '2025-06-04',
      effort: { amount: 1, unit: 'days' as const },
    };
    expect(slackDays(task.dueDate, task.effort, '2025-06-01')).toBeCloseTo(2);
  });

  test('is negative once the deadline is already unreachable', () => {
    expect(slackDays('2025-06-02', { amount: 3, unit: 'days' }, '2025-06-01')).toBeLessThan(0);
  });
});
