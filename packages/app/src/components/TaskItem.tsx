import { useState, useRef, useEffect } from 'react';
import type { Task, Effort, TaskLocation, SubtaskLocation, NewTaskInput, TaskFields } from '@markdone/core';
import DueDatePicker from './DueDatePicker';

interface TaskItemProps {
  task: Task;
  location: TaskLocation;
  onComplete: (location: TaskLocation, actual?: { duration?: Effort }) => void;
  onUncomplete: (location: TaskLocation) => void;
  onUpdate: (location: TaskLocation, changes: Partial<TaskFields>) => void;
  onDelete: (location: TaskLocation) => void;
  onAddSubtask: (parentLocation: TaskLocation, subtask: NewTaskInput) => void;
  onUpdateSubtask: (location: SubtaskLocation, changes: Partial<TaskFields>) => void;
  onOpenDetail?: (location: TaskLocation) => void;
  isSubtask?: boolean;
}

function formatDueDate(dateStr: string): { label: string; className: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(dateStr + 'T00:00:00');
  const diff = (due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
  if (diff < 0) return { label: dateStr, className: 'text-red-500 dark:text-red-400' };
  if (diff === 0) return { label: 'Today', className: 'text-amber-500 dark:text-amber-400' };
  if (diff === 1) return { label: 'Tomorrow', className: 'text-blue-500 dark:text-blue-400' };
  return { label: dateStr, className: 'text-gray-400 dark:text-gray-500' };
}

function getTaskSigils(task: Task): string[] {
  const sigils: string[] = [];
  // due date is shown separately below the text, not as a sigil
  for (const ctx of task.contexts) sigils.push(`@${ctx}`);
  if (task.value !== undefined) sigils.push(`$${task.value}`);
  if (task.complexity !== undefined) sigils.push(`%${task.complexity}`);
  if (task.effort) sigils.push(`~${task.effort.amount}${task.effort.unit}`);
  if (task.actual) {
    const a = task.actual;
    if (a.duration) sigils.push(`&${a.duration.amount}${a.duration.unit}`);
    else sigils.push('&');
  }
  for (const tag of task.tags) {
    if (tag.type === 'label') sigils.push(`#${tag.name}`);
    else sigils.push(`#${tag.key}/${tag.value}`);
  }
  return sigils;
}

// Open/done render distinctly already (empty vs. checked box). Cancelled and
// "other" (any checkbox marker the format doesn't assign meaning to, e.g.
// Obsidian Tasks' `[/]`) share one undifferentiated treatment here — a
// visible signal that the task isn't simply open, not a full status feature.
function isSetAside(task: Task): boolean {
  return task.checkbox.state === 'cancelled' || task.checkbox.state === 'other';
}

export default function TaskItem({
  task,
  location,
  onComplete,
  onUncomplete,
  onUpdate,
  onDelete,
  onAddSubtask,
  onUpdateSubtask,
  onOpenDetail,
  isSubtask = false,
}: TaskItemProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(task.text);
  const [showDurationPrompt, setShowDurationPrompt] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [subtaskText, setSubtaskText] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const subtaskInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) setEditText(task.text);
  }, [task.text, isEditing]);

  function handleCheckbox() {
    if (task.completed) {
      onUncomplete(location);
    } else {
      setShowDurationPrompt(true);
    }
  }

  function submitComplete(durationText?: string) {
    let duration: Effort | undefined;
    if (durationText) {
      const match = durationText.trim().match(/^(\d+(?:\.\d+)?)\s*(min|mins|hr|hrs|h|day|days|d|wk|wks|w)$/i);
      if (match) {
        const amount = parseFloat(match[1]);
        const rawUnit = match[2].toLowerCase();
        let unit: Effort['unit'] = 'min';
        if (rawUnit.startsWith('h')) unit = 'hrs';
        else if (rawUnit.startsWith('d')) unit = 'days';
        else if (rawUnit.startsWith('w')) unit = 'wks';
        duration = { amount, unit };
      }
    }
    onComplete(location, duration ? { duration } : undefined);
    setShowDurationPrompt(false);
  }

  function handleTextClick() {
    if (!task.completed) {
      setIsEditing(true);
      setEditText(task.text);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  function handleTextSubmit() {
    const trimmed = editText.trim();
    if (trimmed && trimmed !== task.text) {
      onUpdate(location, { text: trimmed });
    }
    setIsEditing(false);
  }

  function handleAddSubtask() {
    const trimmed = subtaskText.trim();
    if (trimmed) {
      onAddSubtask(location, { text: trimmed });
      setSubtaskText('');
    }
    setAddingSubtask(false);
  }

  function handleDateSelect(date: string | undefined) {
    onUpdate(location, { dueDate: date });
  }

  function handleSubtaskToggle(subtaskIndex: number, completed: boolean) {
    // TaskFields has no `completed`/`checkbox` fields — completion is a
    // dedicated field pair kept in sync by completeTask/uncompleteTask for
    // top-level tasks, and there's no equivalent op for subtasks. Passing
    // both here directly is safe at runtime (updateSubtask's merge is a
    // plain object spread, not a TaskFields-shaped transform) and keeps
    // checkbox.marker in sync with completed — without it, the checkbox
    // would render as done in the app but serialize back as "- [ ]".
    const checkbox = completed ? { state: 'done' as const, marker: 'x' } : { state: 'open' as const, marker: ' ' };
    onUpdateSubtask({ ...location, subtaskIndex }, { completed, checkbox } as Partial<TaskFields>);
    if (completed) {
      const allDone = task.subtasks.every((st, i) => i === subtaskIndex ? true : st.completed);
      if (allDone && !task.completed) onComplete(location);
    } else {
      if (task.completed) onUncomplete(location);
    }
  }

  const sigils = getTaskSigils(task);

  function handleCardDoubleClick() {
    if (!onOpenDetail) return;
    setIsEditing(false);
    setShowDatePicker(false);
    onOpenDetail(location);
  }

  return (
    <div className={`group ${isSubtask ? 'pl-6' : ''}`} onDoubleClick={handleCardDoubleClick}>
      <div className="flex items-start gap-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-800/50 px-2">
        {/* Checkbox */}
        <button
          onClick={handleCheckbox}
          className={`mt-0.5 w-4 h-4 flex-shrink-0 rounded border transition-colors ${
            task.completed
              ? 'bg-gray-300 border-gray-300 dark:bg-gray-600 dark:border-gray-600'
              : isSetAside(task)
              ? 'bg-gray-100 border-gray-300 dark:bg-gray-700 dark:border-gray-600'
              : 'border-gray-300 dark:border-gray-600 hover:border-indigo-500 dark:hover:border-indigo-400'
          }`}
          aria-label={task.completed ? 'Mark incomplete' : 'Mark complete'}
        >
          {task.completed ? (
            <svg className="w-3 h-3 text-white dark:text-gray-300 m-auto" viewBox="0 0 12 12" fill="currentColor">
              <path d="M10 3L5 8.5 2 5.5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          ) : isSetAside(task) ? (
            <svg className="w-3 h-3 text-gray-400 dark:text-gray-500 m-auto" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M3 6h6" strokeLinecap="round" />
            </svg>
          ) : null}
        </button>

        {/* Task content + sigils */}
        <div className="flex-1 min-w-0 flex items-baseline gap-2">
          <div className="flex-1 min-w-0">
            {isEditing ? (
              <input
                ref={inputRef}
                value={editText}
                onChange={e => setEditText(e.target.value)}
                onBlur={handleTextSubmit}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleTextSubmit();
                  if (e.key === 'Escape') setIsEditing(false);
                }}
                className="w-full text-sm bg-transparent outline-none border-b border-indigo-500 dark:border-indigo-400"
              />
            ) : (
              <span
                onClick={handleTextClick}
                className={`text-sm cursor-text leading-relaxed ${
                  task.completed || isSetAside(task)
                    ? 'line-through text-gray-400 dark:text-gray-500'
                    : 'text-gray-800 dark:text-gray-200'
                }`}
              >
                {task.text}
              </span>
            )}
            {task.subtasks.length > 0 && !isEditing && (() => {
              const done = task.subtasks.filter(st => st.completed).length;
              const total = task.subtasks.length;
              const pct = Math.round((done / total) * 100);
              return (
                <span className="ml-1.5 text-xs text-gray-400 dark:text-gray-500">
                  {done}/{total} ({pct}%)
                </span>
              );
            })()}
            {/* Due date below text */}
            <div className="relative mt-0.5">
              {task.dueDate ? (() => {
                const dueInfo = formatDueDate(task.dueDate);
                return (
                  <button
                    onClick={() => setShowDatePicker(v => !v)}
                    className={`text-xs hover:underline ${dueInfo.className}`}
                    title="Click to change due date"
                  >
                    {dueInfo.label}
                  </button>
                );
              })() : (
                !task.completed && (
                  <button
                    onClick={() => setShowDatePicker(v => !v)}
                    className="text-xs text-gray-300 dark:text-gray-600 opacity-0 group-hover:opacity-100 hover:text-gray-500 dark:hover:text-gray-400 transition-opacity"
                    title="Set due date"
                  >
                    + due date
                  </button>
                )
              )}
              {showDatePicker && (
                <DueDatePicker
                  currentDate={task.dueDate}
                  onSelect={handleDateSelect}
                  onClose={() => setShowDatePicker(false)}
                />
              )}
            </div>
          </div>

          {/* Sigils */}
          {onOpenDetail && (
            sigils.length > 0 ? (
              <button
                onClick={() => onOpenDetail(location)}
                className="flex-shrink-0 text-xs text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 font-mono whitespace-nowrap transition-colors"
                title="View details"
              >
                {sigils.join(' ')}
              </button>
            ) : (
              <button
                onClick={() => onOpenDetail(location)}
                className="flex-shrink-0 text-xs text-gray-200 dark:text-gray-700 hover:text-gray-400 dark:hover:text-gray-500 transition-colors"
                title="Open details to add attributes"
              >
                ···
              </button>
            )
          )}
        </div>

        {/* Action buttons (hidden until hover) */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          {!task.completed && !isSubtask && (
            <button
              onClick={() => {
                setAddingSubtask(true);
                setTimeout(() => subtaskInputRef.current?.focus(), 0);
              }}
              className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              title="Add subtask"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M8 3v10M3 8h10" strokeLinecap="round" />
              </svg>
            </button>
          )}
          {!task.completed && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="p-1 text-gray-400 hover:text-red-500 dark:hover:text-red-400"
              title="Delete task"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 4h10M6 4V2h4v2M5 4v9h6V4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Duration prompt on completion */}
      {showDurationPrompt && (
        <div className="ml-8 mt-1 mb-2">
          <DurationPrompt
            onSubmit={submitComplete}
            onDismiss={() => submitComplete()}
          />
        </div>
      )}

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="ml-8 mt-1 mb-2 flex items-center gap-2 text-sm">
          <span className="text-gray-600 dark:text-gray-400">Delete this task?</span>
          <button
            onClick={() => { onDelete(location); setShowDeleteConfirm(false); }}
            className="text-red-500 hover:text-red-700 font-medium"
          >
            Delete
          </button>
          <button
            onClick={() => setShowDeleteConfirm(false)}
            className="text-gray-400 hover:text-gray-600"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Subtask input */}
      {addingSubtask && (
        <div className="ml-8 mt-1 mb-1">
          <input
            ref={subtaskInputRef}
            value={subtaskText}
            onChange={e => setSubtaskText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleAddSubtask();
              if (e.key === 'Escape') setAddingSubtask(false);
            }}
            onBlur={handleAddSubtask}
            placeholder="Add subtask..."
            className="w-full text-sm bg-transparent outline-none border-b border-gray-300 dark:border-gray-600 placeholder-gray-400 py-0.5"
          />
        </div>
      )}

      {/* Subtasks */}
      {task.subtasks.map((subtask, subtaskIndex) => (
        <SubtaskRow
          key={subtask.id}
          task={subtask}
          subtaskIndex={subtaskIndex}
          onToggle={handleSubtaskToggle}
        />
      ))}
    </div>
  );
}

function DurationPrompt({
  onSubmit,
  onDismiss,
}: {
  onSubmit: (duration?: string) => void;
  onDismiss: () => void;
}) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-gray-500 dark:text-gray-400">How long did this take?</span>
      <input
        ref={inputRef}
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') onSubmit(value || undefined);
          if (e.key === 'Escape') onDismiss();
        }}
        placeholder="e.g. 30min, 2hrs"
        className="w-32 text-xs bg-transparent outline-none border-b border-gray-300 dark:border-gray-600 placeholder-gray-400"
      />
      <button onClick={() => onSubmit(value || undefined)} className="text-indigo-500 hover:text-indigo-700 text-xs">
        Save
      </button>
      <button onClick={onDismiss} className="text-gray-400 hover:text-gray-600 text-xs">
        Skip
      </button>
    </div>
  );
}

function SubtaskRow({
  task,
  subtaskIndex,
  onToggle,
}: {
  task: Task;
  subtaskIndex: number;
  onToggle: (subtaskIndex: number, completed: boolean) => void;
}) {
  return (
    <div className="pl-6 flex items-center gap-2 py-1 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800/50">
      <button
        onClick={() => onToggle(subtaskIndex, !task.completed)}
        className={`w-3.5 h-3.5 flex-shrink-0 rounded border transition-colors ${
          task.completed
            ? 'bg-gray-300 border-gray-300 dark:bg-gray-600 dark:border-gray-600'
            : isSetAside(task)
            ? 'bg-gray-100 border-gray-300 dark:bg-gray-700 dark:border-gray-600'
            : 'border-gray-300 dark:border-gray-600 hover:border-indigo-400'
        }`}
      />
      <span
        className={`text-xs leading-relaxed ${
          task.completed || isSetAside(task)
            ? 'line-through text-gray-400 dark:text-gray-500'
            : 'text-gray-700 dark:text-gray-300'
        }`}
      >
        {task.text}
      </span>
    </div>
  );
}
