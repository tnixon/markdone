import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ResolvedWorkspace, FileChange, OperationContext } from '@markdone/core';
import { getOperation, buildQueryState, runOperation, formatDiff, localDateString, ExternalChangeError } from '@markdone/core';
import { buildTools } from './tools';
import { computeToken } from './token';

const SERVER_NAME = 'markdone';
// Injected at build time via esbuild's `define` (see packages/toolkit/build.mjs)
// from the publishing package's own package.json version. The fallback
// covers every other caller of this file that doesn't pass that define:
// packages/mcp's own build.mjs, and this package's test suite importing
// server.ts directly.
declare const __MARKDONE_VERSION__: string | undefined;
const SERVER_VERSION = typeof __MARKDONE_VERSION__ !== 'undefined' ? __MARKDONE_VERSION__ : '0.0.0-dev';

function textResult(text: string, isError = false): CallToolResult {
  return { content: [{ type: 'text', text }], isError };
}

function formatChanges(changes: FileChange[]): string {
  return changes.length === 0 ? '(no file changes)' : changes.map(c => formatDiff(c.path, c.before, c.after)).join('\n\n');
}

// The unconfirmed-preview and stale-token-retry responses share this exact
// shape, so a client sees an identical structure either way.
function previewText(description: string, changes: FileChange[], token: string): string {
  return [`Preview: ${description}`, '', formatChanges(changes), '', `token: ${token}`].join('\n');
}

function appliedText(description: string, changes: FileChange[]): string {
  return [`Applied: ${description}`, '', formatChanges(changes)].join('\n');
}

// Builds the MCP server for a fixed set of named workspaces (resolved once
// at startup by main.ts). Every tool call names one of these workspaces by
// the `workspace` argument tools.ts adds to each tool's schema; the
// registry's own workspaceId parameter(s) inside a call's arguments are
// passed through unmodified rather than rewritten from `workspace` — see
// the ledger for why (moveTask's cross-workspace `to.workspaceId` would
// break under a blind overwrite).
export interface ServerOptions {
  // Injectable for deterministic tests; "today" is this clock's local date.
  now?: () => Date;
}

export function createServer(workspaces: Map<string, ResolvedWorkspace>, { now = () => new Date() }: ServerOptions = {}): Server {
  const tools = buildTools();
  const toolsByName = new Map(tools.map(t => [t.name, t]));

  const server = new Server({ name: SERVER_NAME, version: SERVER_VERSION }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async request => {
    const tool = toolsByName.get(request.params.name);
    if (!tool) return textResult(`Unknown tool: ${request.params.name}`, true);

    const args = { ...(request.params.arguments ?? {}) } as Record<string, unknown>;
    const workspaceName = args.workspace as string | undefined;
    const confirm = args.confirm === true;
    const token = args.token as string | undefined;
    delete args.workspace;
    delete args.confirm;
    delete args.token;
    const opInput = args;

    // A mutation always targets exactly one workspace — required. A query
    // can span every configured workspace when `workspace` is omitted, the
    // way the CLI's own multi-`--workspace` queries do.
    let targetWorkspaces: ResolvedWorkspace[];
    if (workspaceName) {
      const resolved = workspaces.get(workspaceName);
      if (!resolved) {
        return textResult(`Unknown workspace '${workspaceName}' — configured workspaces: ${[...workspaces.keys()].join(', ') || '(none)'}`, true);
      }
      targetWorkspaces = [resolved];
    } else if (tool.mutating) {
      return textResult(`Missing required 'workspace' argument`, true);
    } else {
      targetWorkspaces = [...workspaces.values()];
    }

    const op = getOperation(tool.opName)!;
    const ctx: OperationContext = { today: localDateString(now()) };

    try {
      for (const ws of targetWorkspaces) await ws.handle.reload();
    } catch (err) {
      return textResult(`Failed to load workspace: ${(err as Error).message}`, true);
    }

    // The SDK validates a call's shape against JSON-RPC, not its arguments
    // against inputSchema — core's own dispatch casts every parameter with
    // no runtime check (e.g. `p.task as NewTaskInput`), so a model that
    // omits a required nested field reaches a TypeError deep inside an
    // operation handler. Everything from here down that touches an
    // operation is wrapped so that surfaces as a tool error, not an
    // uncaught crash of the whole request.
    try {
      if (!tool.mutating) {
        const state = buildQueryState(targetWorkspaces);
        const result = runOperation(tool.opName, state, opInput, ctx);
        if (!result.ok) return textResult(`Error [${result.error.code}]: ${result.error.message}`, true);
        return textResult(JSON.stringify(result.value, null, 2));
      }

      // Mutating: exactly one target workspace, guaranteed by the branch
      // above. Preview-then-confirm below: every branch re-previews
      // against the reload() above, so the description/diff/token a caller
      // sees always reflects the current on-disk state, never a stale
      // in-memory one.
      const resolved = targetWorkspaces[0];
      const preview = await resolved.handle.previewOperation(op, opInput, ctx);
      if (!preview.ok) return textResult(`Error [${preview.error.code}]: ${preview.error.message}`, true);
      const freshToken = computeToken(resolved.id, tool.opName, opInput, preview.value.changes);

      if (!confirm) {
        return textResult(previewText(preview.value.description, preview.value.changes, freshToken));
      }

      if (token === undefined) {
        return textResult(`confirm: true requires the token from a prior preview of this exact call`, true);
      }

      if (token !== freshToken) {
        return textResult(
          [
            'The workspace changed since this was last previewed — call again with this fresh token to apply it.',
            previewText(preview.value.description, preview.value.changes, freshToken),
          ].join('\n\n'),
          true,
        );
      }

      try {
        const applied = await resolved.handle.applyOperation(op, opInput, ctx);
        if (!applied.ok) return textResult(`Error [${applied.error.code}]: ${applied.error.message}`, true);
        // Report what applyOperation itself wrote, not the separate preview
        // above — a plan isn't pure when it mints a fresh id (addTask,
        // addSubtask, assignTaskIds all do by default), so the preview and
        // the apply can legitimately disagree on the exact ^id written.
        return textResult(appliedText(applied.value.description, applied.value.changes));
      } catch (err) {
        if (err instanceof ExternalChangeError) {
          // The narrow window between the reload()+previewOperation above and
          // this applyOperation — core's own mtime guard, as a last resort
          // behind the token check.
          await resolved.handle.reload();
          const retryPreview = await resolved.handle.previewOperation(op, opInput, ctx);
          if (retryPreview.ok) {
            const retryToken = computeToken(resolved.id, tool.opName, opInput, retryPreview.value.changes);
            return textResult(
              ['The workspace changed since this was last previewed — call again with this fresh token to apply it.', previewText(retryPreview.value.description, retryPreview.value.changes, retryToken)].join('\n\n'),
              true,
            );
          }
          return textResult(err.message, true);
        }
        throw err;
      }
    } catch (err) {
      return textResult(`Error: ${(err as Error).message}`, true);
    }
  });

  return server;
}
