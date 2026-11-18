import React, { useState } from 'react';
import { setStoredApiKey, API_KEY_PREFIX } from '../../ai/anthropicClient';

interface Props {
  onKeySet: () => void;
}

export default function ApiKeySetup({ onKeySet }: Props) {
  const [key, setKey] = useState('');
  const [error, setError] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = key.trim();
    if (!trimmed.startsWith(API_KEY_PREFIX)) {
      setError(`API keys start with "${API_KEY_PREFIX}"`);
      return;
    }
    setStoredApiKey(trimmed);
    onKeySet();
  }

  return (
    <div className="flex flex-col items-center justify-center h-full px-6 py-8 text-center">
      <div className="w-10 h-10 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center mb-4">
        <svg className="w-5 h-5 text-indigo-600 dark:text-indigo-400" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M18 8a6 6 0 01-7.743 5.743L10 14l-1 1-1 1H6v2H2v-4l4.257-4.257A6 6 0 1118 8zm-6-4a1 1 0 100 2 2 2 0 012 2 1 1 0 102 0 4 4 0 00-4-4z" clipRule="evenodd" />
        </svg>
      </div>
      <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-1">
        Anthropic API Key Required
      </h3>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-1 max-w-xs">
        Your key is stored in <span className="font-mono">localStorage</span> and used only for direct
        HTTPS calls to <span className="font-mono">api.anthropic.com</span>.
      </p>
      <p className="text-xs text-amber-600 dark:text-amber-400 mb-4 max-w-xs">
        ⚠ Any browser extension or XSS vulnerability could read this key. Do not use on untrusted
        networks or shared devices.
      </p>
      <form onSubmit={handleSubmit} className="w-full max-w-xs">
        <input
          type="password"
          value={key}
          onChange={e => { setKey(e.target.value); setError(''); }}
          placeholder="sk-ant-..."
          className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 outline-none focus:ring-1 focus:ring-indigo-500 mb-2"
          autoFocus
        />
        {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
        <button
          type="submit"
          disabled={!key.trim()}
          className="w-full text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-lg px-3 py-2 transition-colors"
        >
          Save &amp; Start Chatting
        </button>
      </form>
    </div>
  );
}
