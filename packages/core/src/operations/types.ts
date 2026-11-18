import type { AppState, Effort, Actual, Tag, TodoFile } from '../model/types';

export interface TaskLocation {
  workspaceId: string;
  projectIndex: number;
  columnIndex?: number; // kanban only
  taskIndex: number;
}

export interface SubtaskLocation extends TaskLocation {
  subtaskIndex: number;
}

// A stable, position-independent reference to a task: its workspace-unique
// `^id` (spec: "Block IDs are unique within the workspace"). Resolved to a
// `TaskLocation`/`SubtaskLocation` at execution time via `resolveTaskRef`/
// `resolveSubtaskRef` (operations/utils.ts) — never cached, since an index
// resolved once can go stale by the time a caller acts on it (e.g. between
// an AI tool's preview and confirm).
export interface TaskAddress {
  workspaceId: string;
  taskId: string;
}

export type TaskRef = TaskLocation | TaskAddress;
export type SubtaskRef = SubtaskLocation | TaskAddress;

// What an operation needs to know about "now", supplied by the caller so the
// operations layer never has to read a clock itself. `today` is the local
// calendar date, YYYY-MM-DD. Callers that omit the context (the app, the
// Obsidian plugin) get the wall clock's local date instead.
export interface OperationContext {
  today: string;
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: OperationError };

export interface OperationError {
  code: string;
  message: string;
}

export interface ActionRecord {
  description: string;
  before: TodoFile;
  after: TodoFile;
  workspaceId: string;
  timestamp: number;
}

export type NewTaskInput = {
  text: string;
  dueDate?: string;
  contexts?: string[];
  value?: number;
  complexity?: number;
  effort?: Effort;
  tags?: Tag[];
};

export type TaskFields = {
  text: string;
  // The task's `^id`. Settable so a caller can assign one in the same write
  // as another change (validated: charset and workspace-wide uniqueness).
  blockId?: string;
  dueDate?: string;
  contexts: string[];
  value?: number;
  complexity?: number;
  effort?: Effort;
  actual?: Actual;
  tags: Tag[];
};

// JSON Schema type for operation registry
export type JSONSchema = Record<string, unknown>;

interface BaseDefinition {
  name: string;
  description: string;
  category: 'task' | 'project' | 'query' | 'batch';
  parameters: JSONSchema;
  returns: JSONSchema;
}

// A mutation carries `describe`, a one-line human-readable summary of what a
// given call *would* do — used to preview a proposed change (e.g. an AI
// tool call) before it's applied, without re-deriving that summary from the
// raw input at every call site.
export interface MutationDefinition extends BaseDefinition {
  mutating: true;
  execute(state: AppState, input: Record<string, unknown>, ctx?: OperationContext): Result<AppState>;
  describe(input: Record<string, unknown>): string;
}

export interface QueryDefinition extends BaseDefinition {
  mutating: false;
  execute(state: AppState, input: Record<string, unknown>, ctx?: OperationContext): Result<unknown>;
}

export type OperationDefinition = MutationDefinition | QueryDefinition;

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, JSONSchema>;
    required?: string[];
  };
}
