import { useState } from 'react';
import {
  getStoredApiKey,
  setStoredApiKey,
  removeStoredApiKey,
  getStoredModel,
  setStoredModel,
  getAutoApply,
  setAutoApply,
  getContextScope,
  setContextScope,
  AVAILABLE_MODELS,
  API_KEY_PREFIX,
} from '../../ai/anthropicClient';
import type { ContextScope } from '../../ai/anthropicClient';

interface Props {
  onClose: () => void;
  onSettingsChange: () => void;
}

export default function AiSettings({ onClose, onSettingsChange }: Props) {
  const [apiKey, setApiKeyState] = useState(getStoredApiKey() ?? '');
  const [model, setModelState] = useState(getStoredModel());
  const [autoApply, setAutoApplyState] = useState(getAutoApply());
  const [contextScope, setContextScopeState] = useState<ContextScope>(getContextScope());
  const [saved, setSaved] = useState(false);

  function handleSave() {
    const trimmed = apiKey.trim();
    if (trimmed) {
      setStoredApiKey(trimmed);
    } else {
      removeStoredApiKey();
    }
    setStoredModel(model);
    setAutoApply(autoApply);
    setContextScope(contextScope);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    onSettingsChange();
  }

  function handleRemoveKey() {
    removeStoredApiKey();
    setApiKeyState('');
    onSettingsChange();
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">AI Settings</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          aria-label="Close settings"
        >
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 3l10 10M13 3L3 13" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-5">
        {/* API Key */}
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            Anthropic API Key
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKeyState(e.target.value)}
            placeholder={`${API_KEY_PREFIX}...`}
            className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 placeholder-gray-400 outline-none focus:ring-1 focus:ring-indigo-500"
          />
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            Stored in <span className="font-mono">localStorage</span>. Used only for direct HTTPS calls to api.anthropic.com.
          </p>
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
            ⚠ Any browser extension or XSS vulnerability could read this key. Do not use on untrusted networks or shared devices.
          </p>
          {getStoredApiKey() && (
            <button
              onClick={handleRemoveKey}
              className="text-xs text-red-500 hover:text-red-700 mt-1"
            >
              Remove key
            </button>
          )}
        </div>

        {/* Model */}
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            Model
          </label>
          <select
            value={model}
            onChange={e => setModelState(e.target.value)}
            className="w-full text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {AVAILABLE_MODELS.map(m => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>

        {/* Auto-apply */}
        <div className="flex items-start gap-3">
          <input
            id="auto-apply"
            type="checkbox"
            checked={autoApply}
            onChange={e => setAutoApplyState(e.target.checked)}
            className="mt-0.5 accent-indigo-600"
          />
          <label htmlFor="auto-apply" className="text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
            <span className="font-medium">Auto-apply changes</span>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
              Apply mutations immediately without a preview prompt. Use with caution.
            </p>
          </label>
        </div>

        {/* Context scope */}
        <div>
          <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1.5">
            Context sent to AI
          </label>
          <div className="space-y-2">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="context-scope"
                value="all"
                checked={contextScope === 'all'}
                onChange={() => setContextScopeState('all')}
                className="mt-0.5 accent-indigo-600"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                <span className="font-medium">All workspaces</span>
                <span className="block text-xs text-gray-400 dark:text-gray-500">Claude sees all your tasks</span>
              </span>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                name="context-scope"
                value="current"
                checked={contextScope === 'current'}
                onChange={() => setContextScopeState('current')}
                className="mt-0.5 accent-indigo-600"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                <span className="font-medium">Current workspace only</span>
                <span className="block text-xs text-gray-400 dark:text-gray-500">More private — Claude only sees the selected workspace</span>
              </span>
            </label>
          </div>
        </div>
      </div>

      <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800">
        <button
          onClick={handleSave}
          className="w-full text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-3 py-2 transition-colors"
        >
          {saved ? 'Saved!' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
