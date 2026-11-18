import type { ChatMessage } from './types';

interface Props {
  message: ChatMessage;
}

export default function ChatMessageView({ message }: Props) {
  const isUser = message.role === 'user';

  if (message.role === 'tool_result') {
    return (
      <div className="flex justify-start mb-2">
        <div className="max-w-[90%] text-xs bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 px-3 py-1.5 rounded-lg">
          <span className="font-medium text-gray-600 dark:text-gray-300">{message.toolName}</span>
          {' '}
          {message.isError ? (
            <span className="text-red-500">failed: {message.content}</span>
          ) : (
            <span>completed</span>
          )}
        </div>
      </div>
    );
  }

  if (message.role === 'tool_preview') {
    return (
      <div className="flex justify-start mb-2">
        <div className="max-w-[90%] bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 px-3 py-2 rounded-lg">
          <p className="text-xs font-medium text-amber-700 dark:text-amber-400 mb-1.5">
            Claude wants to: {message.description}
          </p>
          <div className="flex gap-2">
            <button
              onClick={message.onApply}
              className="text-xs px-2.5 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded transition-colors"
            >
              Apply
            </button>
            <button
              onClick={message.onDecline}
              className="text-xs px-2.5 py-1 border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded transition-colors"
            >
              Decline
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-2`}>
      <div
        className={`max-w-[85%] px-3 py-2 rounded-lg text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? 'bg-indigo-600 text-white'
            : 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-100'
        }`}
      >
        {message.content}
        {message.role === 'assistant' && message.streaming && (
          <span className="inline-block w-1.5 h-3.5 ml-0.5 bg-current opacity-70 animate-pulse align-middle" />
        )}
      </div>
    </div>
  );
}
