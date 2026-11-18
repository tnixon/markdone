import React, { useState, useEffect } from 'react';
import type { Task, Effort, Tag, Actual, TaskLocation, TaskFields } from '@markdone/core';
import EffortInput from './EffortInput';

interface TaskDetailPanelProps {
  task: Task;
  location: TaskLocation;
  onUpdate: (location: TaskLocation, changes: Partial<TaskFields>) => void;
  onClose: () => void;
}

function parseTagInput(raw: string): Tag | null {
  const s = raw.trim().replace(/^#/, '');
  // v2 canonical: #key/value, split on the first slash.
  const slash = s.indexOf('/');
  if (slash !== -1) return { type: 'nested', key: s.slice(0, slash), value: s.slice(slash + 1) };
  // Still accepted as input shorthand for the same thing.
  const kvMatch = s.match(/^([A-Za-z0-9_-]+)\(([^)]*)\)$/);
  if (kvMatch) return { type: 'nested', key: kvMatch[1], value: kvMatch[2] };
  if (/^[A-Za-z0-9_-]+$/.test(s)) return { type: 'label', name: s };
  return null;
}

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-1 bg-gray-50 dark:bg-gray-800/60 border-y border-gray-100 dark:border-gray-800">
      <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
        {label}
      </span>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-24 flex-shrink-0 text-xs text-gray-400 dark:text-gray-500">{label}</span>
      <div className="flex-1">{children}</div>
    </div>
  );
}

export default function TaskDetailPanel({ task, location, onUpdate, onClose }: TaskDetailPanelProps) {
  const [descText, setDescText] = useState(task.text);
  const [contextInput, setContextInput] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [valueText, setValueText] = useState(task.value?.toString() ?? '');
  const [complexityText, setComplexityText] = useState(task.complexity?.toString() ?? '');

  useEffect(() => { setDescText(task.text); }, [task.text]);
  useEffect(() => { setValueText(task.value?.toString() ?? ''); }, [task.value]);
  useEffect(() => { setComplexityText(task.complexity?.toString() ?? ''); }, [task.complexity]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  function handleDescriptionBlur() {
    const trimmed = descText.trim();
    if (trimmed && trimmed !== task.text) {
      onUpdate(location, { text: trimmed });
    } else {
      setDescText(task.text);
    }
  }

  function addContext() {
    const raw = contextInput.trim().replace(/^@/, '');
    if (!raw || !/^[A-Za-z0-9_-]+$/.test(raw)) return;
    if (!task.contexts.includes(raw)) {
      onUpdate(location, { contexts: [...task.contexts, raw] });
    }
    setContextInput('');
  }

  function removeContext(ctx: string) {
    onUpdate(location, { contexts: task.contexts.filter(c => c !== ctx) });
  }

  function addTag() {
    const tag = parseTagInput(tagInput);
    if (!tag) return;
    onUpdate(location, { tags: [...task.tags, tag] });
    setTagInput('');
  }

  function removeTag(index: number) {
    onUpdate(location, { tags: task.tags.filter((_, i) => i !== index) });
  }

  function handleValueBlur() {
    const raw = valueText.trim();
    if (!raw) {
      onUpdate(location, { value: undefined });
    } else {
      const n = parseFloat(raw);
      if (!isNaN(n)) onUpdate(location, { value: n });
    }
  }

  function handleComplexityBlur() {
    const raw = complexityText.trim();
    if (!raw) {
      onUpdate(location, { complexity: undefined });
    } else {
      const n = parseFloat(raw);
      if (!isNaN(n)) onUpdate(location, { complexity: n });
    }
  }

  function updateActual(changes: { startDate?: string; completionDate?: string; duration?: Effort }) {
    const startDate = 'startDate' in changes ? changes.startDate : task.actual?.startDate;
    const completionDate = 'completionDate' in changes ? changes.completionDate : task.actual?.completionDate;
    const duration = 'duration' in changes ? changes.duration : task.actual?.duration;

    if (!completionDate) {
      onUpdate(location, { actual: undefined });
      return;
    }

    const actual: Actual = { completionDate };
    if (startDate) actual.startDate = startDate;
    if (duration) actual.duration = duration;
    onUpdate(location, { actual });
  }

  const inputCls = 'w-full text-sm bg-transparent outline-none border-b border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 placeholder-gray-400 py-0.5';

  return (
    <div className="fixed inset-y-0 right-0 w-80 bg-white dark:bg-gray-900 border-l border-gray-200 dark:border-gray-800 shadow-xl z-40 flex flex-col">
      {/* Header */}
      <div className="flex items-start gap-2 px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
        <textarea
          value={descText}
          onChange={e => setDescText(e.target.value)}
          onBlur={handleDescriptionBlur}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleDescriptionBlur(); }
          }}
          rows={2}
          className="flex-1 text-sm text-gray-700 dark:text-gray-300 leading-snug bg-transparent outline-none resize-none min-w-0"
        />
        <button
          onClick={onClose}
          className="flex-shrink-0 p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          aria-label="Close detail panel"
        >
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 3l10 10M13 3L3 13" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto py-3 flex flex-col gap-4">

        {/* Due date */}
        <div className="px-4">
          <FieldRow label="Due date">
            <input
              type="date"
              value={task.dueDate ?? ''}
              onChange={e => onUpdate(location, { dueDate: e.target.value || undefined })}
              className={inputCls}
            />
          </FieldRow>
        </div>

        {/* Contexts */}
        <div className="px-4">
          <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
            Contexts
          </label>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {task.contexts.map(ctx => (
              <span
                key={ctx}
                className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800"
              >
                @{ctx}
                <button
                  onClick={() => removeContext(ctx)}
                  className="hover:text-blue-800 dark:hover:text-blue-200 leading-none"
                  aria-label={`Remove @${ctx}`}
                >×</button>
              </span>
            ))}
          </div>
          <input
            value={contextInput}
            onChange={e => setContextInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addContext(); }
              if (e.key === 'Escape') { e.stopPropagation(); setContextInput(''); }
            }}
            placeholder="home, computer…"
            className={inputCls}
          />
        </div>

        {/* ── Estimates ── */}
        <SectionHeader label="Estimates" />

        <div className="px-4 flex flex-col gap-3">
          <FieldRow label="Value">
            <input
              type="number"
              min="0"
              step="0.1"
              value={valueText}
              onChange={e => setValueText(e.target.value)}
              onBlur={handleValueBlur}
              placeholder="e.g. 7"
              className={inputCls}
            />
          </FieldRow>
          <FieldRow label="Complexity">
            <input
              type="number"
              min="0"
              step="1"
              value={complexityText}
              onChange={e => setComplexityText(e.target.value)}
              onBlur={handleComplexityBlur}
              placeholder="e.g. 5"
              className={inputCls}
            />
          </FieldRow>
          <FieldRow label="Effort">
            <EffortInput
              value={task.effort}
              onChange={effort => onUpdate(location, { effort })}
            />
          </FieldRow>
        </div>

        {/* ── Actual ── */}
        <SectionHeader label="Actual" />

        <div className="px-4 flex flex-col gap-3">
          <FieldRow label="Start date">
            <input
              type="date"
              value={task.actual?.startDate ?? ''}
              onChange={e => updateActual({ startDate: e.target.value || undefined })}
              className={inputCls}
            />
          </FieldRow>
          <FieldRow label="End date">
            <input
              type="date"
              value={task.actual?.completionDate ?? ''}
              onChange={e => updateActual({ completionDate: e.target.value || undefined })}
              className={inputCls}
            />
          </FieldRow>
          <FieldRow label="Duration">
            <EffortInput
              value={task.actual?.duration}
              onChange={duration => updateActual({ duration })}
            />
          </FieldRow>
        </div>

        {/* ── Tags ── */}
        <SectionHeader label="Tags" />

        <div className="px-4">
          <div className="flex flex-wrap gap-1.5 mb-2">
            {task.tags.map((tag, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700"
              >
                {tag.type === 'label' ? `#${tag.name}` : `#${tag.key}/${tag.value}`}
                <button
                  onClick={() => removeTag(i)}
                  className="hover:text-gray-900 dark:hover:text-gray-200 leading-none"
                  aria-label="Remove tag"
                >×</button>
              </span>
            ))}
          </div>
          <input
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(); }
              if (e.key === 'Escape') { e.stopPropagation(); setTagInput(''); }
            }}
            placeholder="#label or #key(value)"
            className={inputCls}
          />
        </div>
      </div>
    </div>
  );
}
