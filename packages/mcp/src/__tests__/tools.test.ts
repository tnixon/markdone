import { operationRegistry } from '@markdone/core';
import { buildTools, toolNameFor } from '../tools';

describe('toolNameFor', () => {
  test('prefixes and snake_cases a registry operation name', () => {
    expect(toolNameFor('addTask')).toBe('markdone_add_task');
    expect(toolNameFor('getNextActions')).toBe('markdone_get_next_actions');
    expect(toolNameFor('applyBatch')).toBe('markdone_apply_batch');
    expect(toolNameFor('score')).toBe('markdone_score');
  });
});

describe('buildTools', () => {
  const tools = buildTools();

  test('produces exactly one tool per registry operation, including applyBatch', () => {
    expect(tools).toHaveLength(operationRegistry.length);
    expect(tools.some(t => t.opName === 'applyBatch')).toBe(true);
  });

  test('markdone_list_tasks offers a withScores option; markdone_score takes no such flag', () => {
    const list = tools.find(t => t.name === 'markdone_list_tasks')!;
    expect(list.inputSchema.properties.withScores).toMatchObject({ type: 'boolean' });
    expect(tools.find(t => t.name === 'markdone_score')!.inputSchema.properties.withScores).toBeUndefined();
  });

  test('every tool name is unique', () => {
    expect(new Set(tools.map(t => t.name)).size).toBe(tools.length);
  });

  test('every tool declares a workspace argument; mutations require it, queries make it optional', () => {
    for (const tool of tools) {
      expect(tool.inputSchema.properties.workspace).toBeDefined();
      if (tool.mutating) {
        expect(tool.inputSchema.required).toContain('workspace');
      } else {
        expect(tool.inputSchema.required).not.toContain('workspace');
      }
    }
  });

  test('a query tool has no confirm/token properties', () => {
    const listTasks = tools.find(t => t.opName === 'listTasks')!;
    expect(listTasks.mutating).toBe(false);
    expect(listTasks.inputSchema.properties.confirm).toBeUndefined();
    expect(listTasks.inputSchema.properties.token).toBeUndefined();
  });

  test('a mutation tool has optional confirm/token properties, not required', () => {
    const addTask = tools.find(t => t.opName === 'addTask')!;
    expect(addTask.mutating).toBe(true);
    expect(addTask.inputSchema.properties.confirm).toBeDefined();
    expect(addTask.inputSchema.properties.token).toBeDefined();
    expect(addTask.inputSchema.required).not.toContain('confirm');
    expect(addTask.inputSchema.required).not.toContain('token');
  });

  test('a tool retains the underlying operation\'s own required parameters', () => {
    const addTask = tools.find(t => t.opName === 'addTask')!;
    expect(addTask.inputSchema.required).toEqual(expect.arrayContaining(['workspaceId', 'projectIndex', 'task']));
  });
});
