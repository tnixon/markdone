import { operationRegistry, operationsByName, runOperation, getOperation } from '../registry';
import { makeAppState, makeChecklist, WORKSPACE_ID, newTask } from './helpers';

describe('operationRegistry shape', () => {
  test('every entry has the fields its mutating/query branch requires', () => {
    for (const op of operationRegistry) {
      expect(typeof op.execute).toBe('function');
      if (op.mutating) {
        expect(typeof op.describe).toBe('function');
      } else {
        expect('describe' in op).toBe(false);
      }
    }
  });

  test('mutating flags match the operation kind', () => {
    const mutatingNames = operationRegistry.filter(op => op.mutating).map(op => op.name);
    const queryNames = operationRegistry.filter(op => !op.mutating).map(op => op.name);

    expect(mutatingNames).toEqual(
      expect.arrayContaining(['addTask', 'updateTask', 'deleteTask', 'addProject', 'applyBatch', 'assignTaskIds']),
    );
    expect(queryNames).toEqual(
      expect.arrayContaining(['getOverdueTasks', 'searchTasks', 'listTasks', 'getWaitingFor', 'score']),
    );
  });

  test('operationsByName has one entry per registry entry, keyed by name', () => {
    expect(operationsByName.size).toBe(operationRegistry.length);
    for (const op of operationRegistry) {
      expect(operationsByName.get(op.name)).toBe(op);
    }
  });

  test('getOperation looks up by name', () => {
    expect(getOperation('addTask')?.name).toBe('addTask');
    expect(getOperation('does-not-exist')).toBeUndefined();
  });
});

describe('describe()', () => {
  test('addTask names the task text', () => {
    const op = operationsByName.get('addTask');
    if (!op?.mutating) throw new Error('expected a mutation');
    expect(op.describe({ task: { text: 'Buy milk' } })).toBe('Add task: "Buy milk"');
  });

  test('addProject names the project', () => {
    const op = operationsByName.get('addProject');
    if (!op?.mutating) throw new Error('expected a mutation');
    expect(op.describe({ name: 'Q3 Planning' })).toBe('Add project: "Q3 Planning"');
  });

  test('applyBatch counts the operations', () => {
    const op = operationsByName.get('applyBatch');
    if (!op?.mutating) throw new Error('expected a mutation');
    expect(op.describe({ operations: [{ op: 'addTask', params: {} }, { op: 'deleteTask', params: {} }] })).toBe(
      'Apply 2 operations',
    );
    expect(op.describe({})).toBe('Apply 0 operations');
  });
});

describe('runOperation', () => {
  test('runs a mutation by name and returns the updated AppState', () => {
    const state = makeAppState(WORKSPACE_ID, makeChecklist());
    const result = runOperation('addTask', state, {
      workspaceId: WORKSPACE_ID,
      projectIndex: 0,
      task: newTask,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const appState = result.value as ReturnType<typeof makeAppState>;
    expect(appState.workspaces[0].todoFile.projects[0].name).toBeDefined();
  });

  test('runs a query by name and returns its data wrapped in a Result', () => {
    const state = makeAppState(WORKSPACE_ID, makeChecklist([{ text: 'Task', contexts: ['home'] }]));
    const result = runOperation('getTasksByContext', state, { context: 'home' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Array.isArray(result.value)).toBe(true);
  });

  test('getNextActions is returned as a plain object, not a Map', () => {
    const state = makeAppState(WORKSPACE_ID, makeChecklist([{ text: 'Task', contexts: ['home'], value: 1 }]));
    const result = runOperation('getNextActions', state, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toBeInstanceOf(Map);
    expect((result.value as Record<string, unknown>).home).toBeDefined();
  });

  test('returns UNKNOWN_OPERATION for an unregistered name', () => {
    const state = makeAppState(WORKSPACE_ID, makeChecklist());
    const result = runOperation('notAnOperation', state, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('UNKNOWN_OPERATION');
  });

  test('a mutation invoked via a TaskAddress resolves like a location would', () => {
    const state = makeAppState(WORKSPACE_ID, makeChecklist([{ blockId: 'abc' }]));
    const result = runOperation('completeTask', state, {
      location: { workspaceId: WORKSPACE_ID, taskId: 'abc' },
    });
    expect(result.ok).toBe(true);
  });

  test('score resolves a TaskAddress and returns the four signals', () => {
    const state = makeAppState(
      WORKSPACE_ID,
      makeChecklist([{ blockId: 'abc', value: 5, contexts: ['work'] }]),
    );
    const result = runOperation('score', state, {
      location: { workspaceId: WORKSPACE_ID, taskId: 'abc' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const scored = result.value as { importance: number | undefined; fit: { contexts: string[] } };
    expect(scored.importance).toBe(5);
    expect(scored.fit.contexts).toEqual(['work']);
  });

  test('listTasks with withScores attaches the same score `score` returns, and leaves rows alone without it', () => {
    const state = makeAppState(
      WORKSPACE_ID,
      makeChecklist([
        { blockId: 'abc', value: 5, contexts: ['work'] },
        { blockId: 'def', value: 2 },
      ]),
    );
    const plain = runOperation('listTasks', state, {});
    const scored = runOperation('listTasks', state, { withScores: true });
    expect(plain.ok && scored.ok).toBe(true);
    if (!plain.ok || !scored.ok) return;

    const plainRows = plain.value as Array<Record<string, unknown>>;
    const scoredRows = scored.value as Array<{ task: { blockId: string }; score: unknown } & Record<string, unknown>>;
    expect(plainRows.every(r => !('score' in r))).toBe(true);
    expect(scoredRows.map(({ score: _score, ...row }) => row)).toEqual(plainRows);

    for (const row of scoredRows) {
      const single = runOperation('score', state, { location: { workspaceId: WORKSPACE_ID, taskId: row.task.blockId } });
      expect(single.ok && row.score).toEqual(single.ok && single.value);
    }
  });

  test('a query wraps a thrown error as a Result failure rather than throwing', () => {
    const state = makeAppState(WORKSPACE_ID, makeChecklist());
    // searchTasks requires a string `query`; omitting it makes
    // `query.toLowerCase()` throw — asQueryExecute must catch that.
    expect(() => runOperation('searchTasks', state, {})).not.toThrow();
    const result = runOperation('searchTasks', state, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('QUERY_FAILED');
  });
});
