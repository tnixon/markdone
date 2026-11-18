import { runOperation, buildQueryState } from '@markdone/core';
import { renderTaskList, renderNextActions, renderAccuracy, renderScore } from './render';

export { buildQueryState };

const ARRAY_RESULT_OPS = new Set([
  'getOverdueTasks',
  'getTasksDueInRange',
  'getTasksByContext',
  'getTasksByTag',
  'searchTasks',
  'listTasks',
  'getWaitingFor',
]);

// Renders a query's result the way a person at a terminal wants to read it.
// --json bypasses this entirely and just stringifies the raw value — see
// run.ts.
export function renderQueryResult(opName: string, value: unknown): string {
  if (ARRAY_RESULT_OPS.has(opName)) return renderTaskList(value as Parameters<typeof renderTaskList>[0]);
  if (opName === 'getNextActions') return renderNextActions(value as Parameters<typeof renderNextActions>[0]);
  if (opName === 'getEstimationAccuracy') return renderAccuracy(value as Parameters<typeof renderAccuracy>[0]);
  if (opName === 'score') return renderScore(value as Parameters<typeof renderScore>[0]);
  return JSON.stringify(value, null, 2);
}

export { runOperation };
