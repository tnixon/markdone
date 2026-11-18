import { operationRegistry } from '@markdone/core';
import type { JSONSchema } from '@markdone/core';

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: { type: 'object'; properties: Record<string, JSONSchema>; required: string[] };
  opName: string;
  mutating: boolean;
}

function toSnakeCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

// markdone_add_task, markdone_get_next_actions, ... — prefixed so this
// server's tools don't collide with another server's in the same client
// session, and mechanically derived so a new registry operation always gets
// a name without anyone hand-writing one.
export function toolNameFor(opName: string): string {
  return `markdone_${toSnakeCase(opName)}`;
}

const MUTATING_WORKSPACE_PROPERTY: JSONSchema = {
  type: 'string',
  description: 'Name of the workspace to operate on, as configured via --workspace on this server.',
};

const QUERY_WORKSPACE_PROPERTY: JSONSchema = {
  type: 'string',
  description:
    'Name of the workspace to query, as configured via --workspace on this server. Omit to query across every configured workspace at once.',
};

const CONFIRM_PROPERTY: JSONSchema = {
  type: 'boolean',
  description: 'Set true, together with the token from a prior preview of this exact call, to apply it. Omitted or false previews the change without writing.',
};

const TOKEN_PROPERTY: JSONSchema = {
  type: 'string',
  description: 'The token returned by a prior preview of this exact call. Required when confirm is true.',
};

// Generates the full MCP tool list from the registry, the same way
// toAnthropicTools() does — except this includes applyBatch (excluded there
// since it isn't a Claude tool, but genuinely useful for an MCP agent
// proposing an atomic multi-step edit) and adds workspace/confirm/token on
// top of each operation's own parameters, since those three are protocol
// concerns the registry itself doesn't know about.
export function buildTools(): McpToolDefinition[] {
  return operationRegistry.map(op => {
    const baseProps = (op.parameters as { properties?: Record<string, JSONSchema> }).properties ?? {};
    const baseRequired = (op.parameters as { required?: string[] }).required ?? [];
    // A mutation always targets exactly one workspace, so `workspace` is
    // required. A query can span every configured workspace at once (the
    // way the CLI's own multi-`--workspace` queries do) — `workspace` stays
    // optional there, scoping to just that one when given.
    const properties: Record<string, JSONSchema> = {
      workspace: op.mutating ? MUTATING_WORKSPACE_PROPERTY : QUERY_WORKSPACE_PROPERTY,
      ...baseProps,
    };
    const required = op.mutating ? ['workspace', ...baseRequired] : [...baseRequired];
    if (op.mutating) {
      properties.confirm = CONFIRM_PROPERTY;
      properties.token = TOKEN_PROPERTY;
    }
    return {
      name: toolNameFor(op.name),
      description: op.description,
      inputSchema: { type: 'object' as const, properties, required },
      opName: op.name,
      mutating: op.mutating,
    };
  });
}
