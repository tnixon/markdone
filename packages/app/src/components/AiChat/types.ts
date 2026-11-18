import type { AppState } from '@markdone/core';

export type ChatRole = 'user' | 'assistant' | 'tool_result' | 'tool_preview';

interface BaseMessage {
  id: string;
}

export interface UserMessage extends BaseMessage {
  role: 'user';
  content: string;
}

export interface AssistantMessage extends BaseMessage {
  role: 'assistant';
  content: string;
  streaming?: boolean;
}

export interface ToolResultMessage extends BaseMessage {
  role: 'tool_result';
  toolName: string;
  toolUseId: string;
  content: string;
  isError?: boolean;
}

export interface ToolPreviewMessage extends BaseMessage {
  role: 'tool_preview';
  toolUseId: string;
  toolName: string;
  description: string;
  nextState: AppState;
  onApply: () => void;
  onDecline: () => void;
}

export type ChatMessage =
  | UserMessage
  | AssistantMessage
  | ToolResultMessage
  | ToolPreviewMessage;
