import { parse, type AppState } from '@markdone/core';
import { classifyTool, executeQueryTool, previewMutationTool } from './toolBridge';

function makeState(): AppState {
  const todoFile = parse('# Inbox\n\n- [ ] Buy milk\n').file;
  return {
    activeScope: 'ws1',
    workspaces: [{ config: { id: 'ws1', name: 'Test', filePath: '/test.md' }, todoFile }],
  };
}

describe('toolBridge', () => {
  describe('classifyTool', () => {
    test('classifies a mutating operation as a mutation', () => {
      expect(classifyTool('addTask')).toBe('mutation');
    });

    test('classifies a non-mutating operation as a query', () => {
      expect(classifyTool('listTasks')).toBe('query');
    });

    test('classifies an unknown tool name as a query (defaults to non-mutating)', () => {
      expect(classifyTool('notARealTool')).toBe('query');
    });
  });

  describe('executeQueryTool', () => {
    test('runs a real query operation and returns its result', () => {
      const result = executeQueryTool('id-1', 'listTasks', {}, makeState());
      expect(result.kind).toBe('query');
    });

    test('refuses to execute a mutating operation', () => {
      const result = executeQueryTool('id-1', 'addTask', { workspaceId: 'ws1', projectIndex: 0, task: { text: 'x' } }, makeState());
      expect(result.kind).toBe('error');
      if (result.kind === 'error') expect(result.message).toMatch(/Unknown query/);
    });

    test('refuses an unknown tool name', () => {
      const result = executeQueryTool('id-1', 'notARealTool', {}, makeState());
      expect(result.kind).toBe('error');
    });
  });

  describe('previewMutationTool', () => {
    test('previews a real mutating operation without applying it to the passed-in state', () => {
      const state = makeState();
      const result = previewMutationTool('id-1', 'addTask', { workspaceId: 'ws1', projectIndex: 0, task: { text: 'New task' } }, state);
      expect(result.kind).toBe('mutation');
      // Original state object is untouched — preview only computes nextState.
      expect(state.workspaces[0].todoFile.projects[0].layout).toBe('checklist');
    });

    test('refuses a non-mutating operation', () => {
      const result = previewMutationTool('id-1', 'listTasks', {}, makeState());
      expect(result.kind).toBe('error');
    });
  });
});
