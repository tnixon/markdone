import React, { useState, useRef, useEffect } from 'react';
import type { AppState } from '@markdone/core';
import type { TodoOperations } from '../../hooks/useTodoOperations';
import {
  getStoredApiKey,
  getStoredModel,
  getAutoApply,
  getContextScope,
  streamMessages,
} from '../../ai/anthropicClient';
import type { ApiMessage, ContentBlock } from '../../ai/anthropicClient';
import { assembleContext } from '../../ai/context';
import { toAnthropicTools } from '@markdone/core';
import { classifyTool, executeQueryTool, previewMutationTool } from '../../ai/toolBridge';
import type { MutationPreview } from '../../ai/toolBridge';
import ChatMessageView from './ChatMessage';
import ApiKeySetup from './ApiKeySetup';
import AiSettings from './AiSettings';
import type { ChatMessage, AssistantMessage } from './types';

interface Props {
  appState: AppState;
  ops: TodoOperations;
  selectedWorkspaceId?: string;
  isOpen: boolean;
  onToggle: () => void;
}

function uid(): string {
  return crypto.randomUUID();
}

export default function AiChat({ appState, ops, selectedWorkspaceId, isOpen, onToggle }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(() => !!getStoredApiKey());
  const [showSettings, setShowSettings] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // The canonical API message history (separate from display messages)
  const apiHistoryRef = useRef<ApiMessage[]>([]);

  // Pending tool-use content accumulated during the current streaming turn
  const pendingToolUsesRef = useRef<Array<{ id: string; name: string; input: Record<string, unknown> }>>([]);
  // Accumulated assistant text in the current streaming turn
  const currentAssistantTextRef = useRef('');

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (isOpen && hasApiKey && !showSettings) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [isOpen, hasApiKey, showSettings]);

  function appendDisplay(msg: ChatMessage) {
    setMessages(prev => [...prev, msg]);
  }

  function updateLastAssistant(updater: (m: AssistantMessage) => AssistantMessage) {
    setMessages(prev => {
      const idx = [...prev].reverse().findIndex(m => m.role === 'assistant');
      if (idx === -1) return prev;
      const realIdx = prev.length - 1 - idx;
      const next = [...prev];
      next[realIdx] = updater(prev[realIdx] as AssistantMessage);
      return next;
    });
  }

  async function runTurn() {
    const apiKey = getStoredApiKey();
    if (!apiKey) return;

    const model = getStoredModel();
    const contextScope = getContextScope();
    const autoApply = getAutoApply();
    const system = assembleContext(appState, contextScope, selectedWorkspaceId);
    const tools = toAnthropicTools();

    setIsStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;

    // Reset per-turn state
    pendingToolUsesRef.current = [];
    currentAssistantTextRef.current = '';

    const assistantMsgId = uid();
    appendDisplay({ id: assistantMsgId, role: 'assistant', content: '', streaming: true });

    await streamMessages(
      apiKey,
      model,
      system,
      apiHistoryRef.current,
      tools,
      {
        onText(text) {
          currentAssistantTextRef.current += text;
          updateLastAssistant(m => ({ ...m, content: currentAssistantTextRef.current }));
        },
        onToolUseStart(_id, _name) {
          // We wait for the full input before acting
        },
        onToolUseDone(id, name, toolInput) {
          pendingToolUsesRef.current.push({ id, name, input: toolInput });
        },
        onDone(_stopReason) {
          // Commit this assistant turn to API history
          const assistantContent: ContentBlock[] = [];
          if (currentAssistantTextRef.current) {
            assistantContent.push({ type: 'text', text: currentAssistantTextRef.current });
          }
          for (const t of pendingToolUsesRef.current) {
            assistantContent.push({ type: 'tool_use', id: t.id, name: t.name, input: t.input });
          }
          if (assistantContent.length > 0) {
            apiHistoryRef.current = [
              ...apiHistoryRef.current,
              { role: 'assistant', content: assistantContent },
            ];
          }

          updateLastAssistant(m => ({ ...m, streaming: false }));

          // Process tool calls
          const toolUses = pendingToolUsesRef.current;
          pendingToolUsesRef.current = [];

          if (toolUses.length === 0) {
            setIsStreaming(false);
            return;
          }

          // Execute all tool calls and collect results
          const toolResults: Array<{ toolUseId: string; content: string; isError: boolean }> = [];

          for (const toolUse of toolUses) {
            const { id, name, input } = toolUse;
            const category = classifyTool(name);

            if (category === 'query') {
              const res = executeQueryTool(id, name, input, appState);
              const content = res.kind === 'query'
                ? JSON.stringify(res.result, null, 2)
                : res.message;
              const isError = res.kind === 'error';
              toolResults.push({ toolUseId: id, content, isError });
              appendDisplay({
                id: uid(), role: 'tool_result', toolName: name, toolUseId: id, content, isError,
              });
            } else {
              // Mutation: preview or auto-apply
              const preview = previewMutationTool(id, name, input, appState);

              if (preview.kind === 'error') {
                toolResults.push({ toolUseId: id, content: preview.message, isError: true });
                appendDisplay({
                  id: uid(), role: 'tool_result', toolName: name, toolUseId: id,
                  content: preview.message, isError: true,
                });
                continue;
              }

              if (autoApply) {
                const mutPreview = preview as MutationPreview;
                applyStateChange(mutPreview.nextState, mutPreview.description);
                toolResults.push({ toolUseId: id, content: 'Applied successfully.', isError: false });
                appendDisplay({
                  id: uid(), role: 'tool_result', toolName: name, toolUseId: id,
                  content: 'Applied', isError: false,
                });
              } else {
                // Show preview that blocks continuation until user acts
                const mutPreview = preview as MutationPreview;
                const previewDisplayId = uid();
                pendingPreviewsRef.current.add(id);
                appendDisplay({
                  id: previewDisplayId,
                  role: 'tool_preview',
                  toolUseId: id,
                  toolName: name,
                  description: mutPreview.description,
                  nextState: mutPreview.nextState,
                  onApply: () => resolvePreview(id, true, mutPreview.nextState, mutPreview.description, previewDisplayId),
                  onDecline: () => resolvePreview(id, false, undefined, undefined, previewDisplayId),
                });
                // Don't add to immediate toolResults — continuation happens on resolve
              }
            }
          }

          const hasPendingPreviews = pendingPreviewsRef.current.size > 0;

          if (hasPendingPreviews) {
            // Store any immediately-resolved results; streaming stays active until all previews resolve
            if (toolResults.length > 0) {
              pendingImmediateResultsRef.current.push(...toolResults);
            }
          } else if (toolResults.length > 0) {
            // All tools resolved immediately — continue without flickering isStreaming
            continueWithToolResults(toolResults);
          } else {
            setIsStreaming(false);
          }
        },
        onError(msg) {
          updateLastAssistant(m => ({
            ...m,
            content: m.content || `Error: ${msg}`,
            streaming: false,
          }));
          setIsStreaming(false);
        },
      },
      controller.signal,
    );
  }

  // Results that have been resolved immediately (query/auto-apply) but are waiting
  // for pending mutation previews to also be resolved before we continue.
  const pendingImmediateResultsRef = useRef<
    Array<{ toolUseId: string; content: string; isError: boolean }>
  >([]);
  // Tracks toolUseIds of previews that are still waiting for user action.
  // continueWithToolResults is only called once this set is empty.
  const pendingPreviewsRef = useRef<Set<string>>(new Set());

  function resolvePreview(
    toolUseId: string,
    accepted: boolean,
    nextState: AppState | undefined,
    description: string | undefined,
    displayMsgId: string,
  ) {
    // Replace preview with a result display
    setMessages(prev =>
      prev.map(m =>
        m.id === displayMsgId
          ? {
              id: m.id,
              role: 'tool_result' as const,
              toolName: (m as { toolName: string }).toolName,
              toolUseId,
              content: accepted ? 'Applied' : 'Declined',
              isError: !accepted,
            }
          : m,
      ),
    );

    if (accepted && nextState) {
      applyStateChange(nextState, description);
    }

    pendingPreviewsRef.current.delete(toolUseId);
    pendingImmediateResultsRef.current.push({
      toolUseId,
      content: accepted ? 'Applied successfully.' : 'User declined this change.',
      isError: !accepted,
    });

    // Only continue once all pending previews have been resolved
    if (pendingPreviewsRef.current.size === 0) {
      const results = [...pendingImmediateResultsRef.current];
      pendingImmediateResultsRef.current = [];
      continueWithToolResults(results);
    }
  }

  function continueWithToolResults(
    results: Array<{ toolUseId: string; content: string; isError: boolean }>,
  ) {
    // Add tool results to API history as a user message
    apiHistoryRef.current = [
      ...apiHistoryRef.current,
      {
        role: 'user',
        content: results.map(r => ({
          type: 'tool_result' as const,
          tool_use_id: r.toolUseId,
          content: r.content,
          is_error: r.isError || undefined,
        })),
      },
    ];
    runTurn();
  }

  function applyStateChange(nextState: AppState, description?: string) {
    for (const nextWs of nextState.workspaces) {
      const prevWs = appState.workspaces.find(w => w.config.id === nextWs.config.id);
      if (prevWs && prevWs.todoFile !== nextWs.todoFile) {
        ops.applyRawWorkspace(nextWs.config.id, nextWs.todoFile, description);
      }
    }
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || isStreaming) return;

    setInput('');
    appendDisplay({ id: uid(), role: 'user', content: text });

    // Add to API history
    apiHistoryRef.current = [...apiHistoryRef.current, { role: 'user', content: text }];

    await runTurn();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function handleStop() {
    abortRef.current?.abort();
    setIsStreaming(false);
    updateLastAssistant(m => ({ ...m, streaming: false }));
  }

  function clearConversation() {
    abortRef.current?.abort();
    setIsStreaming(false);
    setMessages([]);
    apiHistoryRef.current = [];
    pendingImmediateResultsRef.current = [];
    pendingPreviewsRef.current.clear();
  }

  return (
    <div
      className={`flex flex-col border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 transition-all duration-200 flex-shrink-0 ${
        isOpen ? 'h-80' : 'h-10'
      }`}
    >
      {/* Header / toggle bar */}
      <div
        className="flex items-center justify-between px-4 h-10 flex-shrink-0 cursor-pointer select-none"
        onClick={onToggle}
        role="button"
        aria-expanded={isOpen}
        aria-label={isOpen ? 'Collapse AI assistant' : 'Expand AI assistant'}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">AI Assistant</span>
          {isStreaming && (
            <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse" />
          )}
          <kbd className="hidden sm:inline-block text-xs px-1 py-0.5 rounded border border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 font-mono">
            ⌘K
          </kbd>
        </div>
        <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
          {isOpen && messages.length > 0 && (
            <button
              onClick={clearConversation}
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              title="Clear conversation"
            >
              Clear
            </button>
          )}
          {isOpen && (
            <button
              onClick={() => setShowSettings(s => !s)}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              title="AI settings"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="8" cy="8" r="2.5" />
                <path d="M8 1.5v1M8 13.5v1M1.5 8h1M13.5 8h1M3.2 3.2l.7.7M12.1 12.1l.7.7M12.8 3.2l-.7.7M3.9 12.1l-.7.7" strokeLinecap="round" />
              </svg>
            </button>
          )}
          <svg
            className={`w-3.5 h-3.5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      {/* Panel body */}
      {isOpen && (
        <div className="flex flex-col flex-1 min-h-0">
          {showSettings ? (
            <AiSettings
              onClose={() => setShowSettings(false)}
              onSettingsChange={() => setHasApiKey(!!getStoredApiKey())}
            />
          ) : !hasApiKey ? (
            <ApiKeySetup onKeySet={() => setHasApiKey(true)} />
          ) : (
            <>
              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 pt-2 pb-1">
                {messages.length === 0 ? (
                  <p className="text-xs text-gray-400 dark:text-gray-500 text-center pt-6">
                    Ask about your tasks, create new ones, or reorganize your projects.
                  </p>
                ) : (
                  messages.map(msg => <ChatMessageView key={msg.id} message={msg} />)
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="px-4 pb-3 flex gap-2 items-end border-t border-gray-100 dark:border-gray-800 pt-2">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Message AI… (Enter to send, Shift+Enter for newline)"
                  rows={1}
                  className="flex-1 text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:ring-1 focus:ring-indigo-500 resize-none"
                  style={{ minHeight: '2.25rem', maxHeight: '5rem' }}
                  disabled={isStreaming}
                />
                {isStreaming ? (
                  <button
                    onClick={handleStop}
                    className="flex-shrink-0 px-3 py-2 text-sm bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    onClick={sendMessage}
                    disabled={!input.trim()}
                    className="flex-shrink-0 px-3 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg transition-colors"
                  >
                    Send
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
