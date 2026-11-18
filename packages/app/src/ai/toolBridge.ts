/**
 * Bridges Claude's tool-use calls to the operations layer.
 *
 * - Query operations execute immediately and return their result.
 * - Mutation operations return a preview that the UI can confirm before applying.
 *
 * Thin by design: every operation's actual behavior, "is this a mutation",
 * and human-readable description already live on its `OperationDefinition`
 * in the core registry (`getOperation`/`runOperation`) — this file just
 * adapts that to the shape the chat UI wants (query vs. preview-then-apply).
 */

import type { AppState, Result } from '@markdone/core';
import { getOperation, runOperation } from '@markdone/core';

export type ToolCategory = 'query' | 'mutation';

export function classifyTool(name: string): ToolCategory {
  const op = getOperation(name);
  return op?.mutating ? 'mutation' : 'query';
}

/** Result returned from a query tool call. */
export interface QueryResult {
  kind: 'query';
  toolUseId: string;
  toolName: string;
  result: unknown;
}

/** Preview for a mutation tool call. Awaiting user confirmation. */
export interface MutationPreview {
  kind: 'mutation';
  toolUseId: string;
  toolName: string;
  input: Record<string, unknown>;
  nextState: AppState;
  description: string;
}

export type ToolCallResult = QueryResult | { kind: 'error'; toolUseId: string; toolName: string; message: string };

/**
 * Execute a query tool call immediately.
 */
export function executeQueryTool(
  toolUseId: string,
  toolName: string,
  input: Record<string, unknown>,
  state: AppState,
): ToolCallResult {
  const op = getOperation(toolName);
  if (!op || op.mutating) {
    return { kind: 'error', toolUseId, toolName, message: `Unknown query: "${toolName}"` };
  }

  const result = runOperation(toolName, state, input);
  if (!result.ok) {
    return { kind: 'error', toolUseId, toolName, message: result.error.message };
  }
  return { kind: 'query', toolUseId, toolName, result: result.value };
}

/**
 * Preview a mutation tool call — compute the resulting state without applying it.
 * Returns the new state so the UI can show a diff before confirming.
 */
export function previewMutationTool(
  toolUseId: string,
  toolName: string,
  input: Record<string, unknown>,
  state: AppState,
): MutationPreview | { kind: 'error'; toolUseId: string; toolName: string; message: string } {
  const op = getOperation(toolName);
  if (!op || !op.mutating) {
    return { kind: 'error', toolUseId, toolName, message: `Unknown mutation: "${toolName}"` };
  }

  const result = runOperation(toolName, state, input) as Result<AppState>;
  if (!result.ok) {
    return { kind: 'error', toolUseId, toolName, message: result.error.message };
  }

  return {
    kind: 'mutation',
    toolUseId,
    toolName,
    input,
    nextState: result.value,
    description: op.describe(input),
  };
}
