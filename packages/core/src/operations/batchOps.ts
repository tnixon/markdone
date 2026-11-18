import type { AppState } from '../model/types';
import type { OperationContext, Result } from './types';
import { operationHandlers } from './dispatch';

// Re-export for consumers who only import from batchOps
export type { Result };

export interface BatchOperation {
  op: string;
  params: Record<string, unknown>;
}

/**
 * Apply a batch of operations sequentially. If any operation fails, the entire
 * batch is rolled back and the original state is returned with the error.
 */
export function applyBatch(
  state: AppState,
  operations: BatchOperation[],
  ctx?: OperationContext,
): Result<{ state: AppState; results: Result<unknown>[] }> {
  let currentState = state;
  const results: Result<unknown>[] = [];

  for (const op of operations) {
    const handler = operationHandlers[op.op];
    if (!handler) {
      return {
        ok: false,
        error: { code: 'UNKNOWN_OPERATION', message: `Unknown operation: '${op.op}'` },
      };
    }

    const result = handler(currentState, op.params, ctx);
    results.push(result as Result<unknown>);

    if (!result.ok) {
      // Roll back: return original state with the error
      return {
        ok: false,
        error: {
          code: 'BATCH_FAILED',
          message: `Batch rolled back. Operation '${op.op}' failed: ${result.error.message}`,
        },
      };
    }

    currentState = result.value;
  }

  return { ok: true, value: { state: currentState, results } };
}
