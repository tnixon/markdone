import { getOperation, formatDiff } from '@markdone/core';
import type { WorkspaceHandle, FileChange, OperationContext } from '@markdone/core';
import { UsageError } from './errors';

export interface MutationOutcome {
  ok: boolean;
  description?: string;
  changes?: FileChange[];
  errorCode?: string;
  errorMessage?: string;
  dryRun: boolean;
}

export async function runMutation(
  opName: string,
  handle: WorkspaceHandle,
  input: Record<string, unknown>,
  dryRun: boolean,
  ctx: OperationContext,
): Promise<MutationOutcome> {
  const op = getOperation(opName);
  if (!op || !op.mutating) throw new UsageError(`Unknown mutation '${opName}'`);

  if (dryRun) {
    const result = await handle.previewOperation(op, input, ctx);
    if (!result.ok) return { ok: false, errorCode: result.error.code, errorMessage: result.error.message, dryRun: true };
    return { ok: true, description: result.value.description, changes: result.value.changes, dryRun: true };
  }

  const applied = await handle.applyOperation(op, input, ctx);
  if (!applied.ok) return { ok: false, errorCode: applied.error.code, errorMessage: applied.error.message, dryRun: false };
  return { ok: true, description: applied.value.description, changes: applied.value.changes, dryRun: false };
}

export function renderMutationOutcome(outcome: MutationOutcome): string {
  if (!outcome.ok) return `Error [${outcome.errorCode}]: ${outcome.errorMessage}`;

  const lines: string[] = [outcome.description ?? ''];
  if (!outcome.changes || outcome.changes.length === 0) {
    lines.push('(no file changes)');
  } else if (outcome.dryRun) {
    for (const change of outcome.changes) lines.push('', formatDiff(change.path, change.before, change.after));
  } else {
    for (const change of outcome.changes) lines.push(`  ${change.after === null ? 'deleted' : change.before === null ? 'created' : 'wrote'} ${change.path}`);
  }
  return lines.join('\n');
}
