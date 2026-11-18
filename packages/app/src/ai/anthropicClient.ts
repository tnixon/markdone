/**
 * Anthropic Messages API client for browser use.
 * Uses direct fetch (no SDK) to avoid package dependencies.
 */

export const API_KEY_PREFIX = 'sk-ant-';

const API_KEY_STORAGE_KEY = 'markdone_anthropic_api_key';
const MODEL_STORAGE_KEY = 'markdone_ai_model';
const AUTO_APPLY_STORAGE_KEY = 'markdone_ai_auto_apply';
const CONTEXT_SCOPE_STORAGE_KEY = 'markdone_ai_context_scope';

export const DEFAULT_MODEL = 'claude-sonnet-4-6';
export const AVAILABLE_MODELS = [
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6 (Recommended)' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (Fast)' },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6 (Powerful)' },
];

// ---- Preference storage ----

export function getStoredApiKey(): string | null {
  return localStorage.getItem(API_KEY_STORAGE_KEY);
}

export function setStoredApiKey(key: string): void {
  localStorage.setItem(API_KEY_STORAGE_KEY, key);
}

export function removeStoredApiKey(): void {
  localStorage.removeItem(API_KEY_STORAGE_KEY);
}

export function getStoredModel(): string {
  return localStorage.getItem(MODEL_STORAGE_KEY) ?? DEFAULT_MODEL;
}

export function setStoredModel(model: string): void {
  localStorage.setItem(MODEL_STORAGE_KEY, model);
}

export function getAutoApply(): boolean {
  return localStorage.getItem(AUTO_APPLY_STORAGE_KEY) === 'true';
}

export function setAutoApply(value: boolean): void {
  localStorage.setItem(AUTO_APPLY_STORAGE_KEY, String(value));
}

export type ContextScope = 'all' | 'current';

export function getContextScope(): ContextScope {
  const stored = localStorage.getItem(CONTEXT_SCOPE_STORAGE_KEY);
  return stored === 'current' ? 'current' : 'all';
}

export function setContextScope(scope: ContextScope): void {
  localStorage.setItem(CONTEXT_SCOPE_STORAGE_KEY, scope);
}

// ---- Message types ----

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface ApiMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ---- Stream callback types ----

export interface StreamCallbacks {
  onText(text: string): void;
  onToolUseStart(id: string, name: string): void;
  onToolUseDone(id: string, name: string, input: Record<string, unknown>): void;
  onDone(stopReason: string): void;
  onError(message: string): void;
}

// ---- Streaming API call ----

/**
 * Stream a response from the Anthropic Messages API.
 * The `anthropic-dangerous-direct-browser-access` header is required for
 * browser clients that call the API without a proxy server.
 */
export async function streamMessages(
  apiKey: string,
  model: string,
  system: string,
  messages: ApiMessage[],
  tools: AnthropicToolDef[],
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system,
        messages,
        tools: tools.length > 0 ? tools : undefined,
        stream: true,
      }),
      signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    callbacks.onError(err instanceof Error ? err.message : 'Network error');
    return;
  }

  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = await response.json();
      message = body?.error?.message ?? message;
    } catch {
      /* ignore */
    }
    callbacks.onError(message);
    return;
  }

  const reader = response.body?.getReader();
  if (!reader) {
    callbacks.onError('No response body');
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';

  // Track tool uses by their content block index
  const toolBlocks: Array<{ id: string; name: string; inputBuffer: string }> = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (!data || data === '[DONE]') continue;

        let event: Record<string, unknown>;
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }

        const eventType = event.type as string;

        if (eventType === 'content_block_start') {
          const block = event.content_block as Record<string, unknown>;
          const index = event.index as number;
          if (block.type === 'tool_use') {
            const id = block.id as string;
            const name = block.name as string;
            toolBlocks[index] = { id, name, inputBuffer: '' };
            callbacks.onToolUseStart(id, name);
          }
        } else if (eventType === 'content_block_delta') {
          const delta = event.delta as Record<string, unknown>;
          const index = event.index as number;
          if (delta.type === 'text_delta') {
            callbacks.onText(delta.text as string);
          } else if (delta.type === 'input_json_delta') {
            const toolBlock = toolBlocks[index];
            if (toolBlock) {
              toolBlock.inputBuffer += delta.partial_json as string;
            }
          }
        } else if (eventType === 'content_block_stop') {
          const index = event.index as number;
          const toolBlock = toolBlocks[index];
          if (toolBlock) {
            try {
              const input = JSON.parse(toolBlock.inputBuffer) as Record<string, unknown>;
              callbacks.onToolUseDone(toolBlock.id, toolBlock.name, input);
            } catch {
              callbacks.onError(`Failed to parse tool input for "${toolBlock.name}"`);
            }
          }
        } else if (eventType === 'message_delta') {
          const delta = event.delta as Record<string, unknown>;
          callbacks.onDone(delta.stop_reason as string);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
