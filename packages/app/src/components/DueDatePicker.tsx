import { useState, useRef, useEffect } from 'react';
import { localDateString } from '@markdone/core';

export function parseNaturalDate(input: string): string | null {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const lower = input.toLowerCase().trim();

  if (lower === 'today') return localDateString(today);

  if (lower === 'tomorrow') {
    const d = new Date(today);
    d.setDate(d.getDate() + 1);
    return localDateString(d);
  }

  if (lower === 'yesterday') {
    const d = new Date(today);
    d.setDate(d.getDate() - 1);
    return localDateString(d);
  }

  const nextDayMatch = lower.match(
    /^next\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/,
  );
  if (nextDayMatch) {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const targetDay = days.indexOf(nextDayMatch[1]);
    const d = new Date(today);
    let daysUntil = targetDay - d.getDay();
    if (daysUntil <= 0) daysUntil += 7;
    d.setDate(d.getDate() + daysUntil);
    return localDateString(d);
  }

  const inNMatch = lower.match(/^in\s+(\d+)\s+(day|days|week|weeks)$/);
  if (inNMatch) {
    const n = parseInt(inNMatch[1]);
    const isWeeks = inNMatch[2].startsWith('w');
    const d = new Date(today);
    d.setDate(d.getDate() + (isWeeks ? n * 7 : n));
    return localDateString(d);
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(lower)) return lower;

  return null;
}

function buildCalendarGrid(year: number, month: number): (number | null)[] {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDow = new Date(year, month, 1).getDay(); // 0=Sun
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DOW_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const QUICK_PICKS = ['today', 'tomorrow', 'next friday', 'in 1 week', 'in 2 weeks'];

interface DueDatePickerProps {
  currentDate?: string;
  onSelect: (date: string | undefined) => void;
  onClose: () => void;
}

export default function DueDatePicker({ currentDate, onSelect, onClose }: DueDatePickerProps) {
  const [input, setInput] = useState(currentDate ?? '');
  const [parsed, setParsed] = useState<string | null>(() => parseNaturalDate(currentDate ?? ''));
  const [calMonth, setCalMonth] = useState<Date>(() => {
    const base = currentDate ? new Date(currentDate + 'T00:00:00') : new Date();
    base.setDate(1);
    return base;
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Sync calendar month when parsed date changes
  useEffect(() => {
    if (parsed) {
      const d = new Date(parsed + 'T00:00:00');
      d.setDate(1);
      setCalMonth(d);
    }
  }, [parsed]);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [onClose]);

  function handleChange(value: string) {
    setInput(value);
    setParsed(parseNaturalDate(value));
  }

  function handleSubmit() {
    if (input.trim() === '') {
      onSelect(undefined);
      onClose();
      return;
    }
    const result = parseNaturalDate(input);
    if (result) {
      onSelect(result);
      onClose();
    }
  }

  function handleQuickPick(suggestion: string) {
    const date = parseNaturalDate(suggestion);
    if (date) {
      onSelect(date);
      onClose();
    }
  }

  function handleCalendarDayClick(day: number) {
    const date = localDateString(new Date(calMonth.getFullYear(), calMonth.getMonth(), day));
    onSelect(date);
    onClose();
  }

  function prevMonth() {
    setCalMonth(m => new Date(m.getFullYear(), m.getMonth() - 1, 1));
  }

  function nextMonth() {
    setCalMonth(m => new Date(m.getFullYear(), m.getMonth() + 1, 1));
  }

  const todayISO = localDateString(new Date());
  const year = calMonth.getFullYear();
  const month = calMonth.getMonth();
  const grid = buildCalendarGrid(year, month);

  return (
    <div
      ref={containerRef}
      className="absolute z-50 mt-1 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 p-3 w-64"
    >
      <input
        ref={inputRef}
        value={input}
        onChange={e => handleChange(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); }
          if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        }}
        placeholder="today, tomorrow, next friday…"
        className="w-full text-sm bg-transparent outline-none border-b border-gray-300 dark:border-gray-600 pb-1 mb-2 text-gray-800 dark:text-gray-200 placeholder-gray-400"
      />
      {parsed && input !== parsed && (
        <div className="text-xs text-green-600 dark:text-green-400 mb-2">→ {parsed}</div>
      )}
      {!parsed && input.trim() !== '' && (
        <div className="text-xs text-red-400 mb-2">Unrecognized date format</div>
      )}
      <div className="flex flex-wrap gap-1 mb-3">
        {QUICK_PICKS.map(s => (
          <button
            key={s}
            onClick={() => handleQuickPick(s)}
            className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"
          >
            {s}
          </button>
        ))}
      </div>

      {/* Calendar */}
      <div className="border-t border-gray-200 dark:border-gray-700 pt-2">
        {/* Month navigation */}
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={prevMonth}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 px-1 text-sm leading-none"
          >
            ‹
          </button>
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
            {MONTH_NAMES[month]} {year}
          </span>
          <button
            onClick={nextMonth}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 px-1 text-sm leading-none"
          >
            ›
          </button>
        </div>

        {/* Day-of-week headers */}
        <div className="grid grid-cols-7 mb-1">
          {DOW_LABELS.map(d => (
            <div key={d} className="text-center text-xs text-gray-400 dark:text-gray-500 font-medium">
              {d}
            </div>
          ))}
        </div>

        {/* Date grid */}
        <div className="grid grid-cols-7 gap-y-0.5">
          {grid.map((day, i) => {
            if (day === null) {
              return <div key={i} />;
            }
            const iso = localDateString(new Date(year, month, day));
            const isToday = iso === todayISO;
            const isSelected = iso === parsed;
            return (
              <button
                key={i}
                onClick={() => handleCalendarDayClick(day)}
                className={[
                  'text-xs w-full aspect-square flex items-center justify-center rounded-full',
                  isSelected
                    ? 'bg-blue-500 text-white font-medium'
                    : isToday
                      ? 'ring-1 ring-blue-400 text-blue-500 dark:text-blue-400 font-medium hover:bg-gray-100 dark:hover:bg-gray-700'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700',
                ].join(' ')}
              >
                {day}
              </button>
            );
          })}
        </div>
      </div>

      {currentDate && (
        <button
          onClick={() => { onSelect(undefined); onClose(); }}
          className="mt-2 text-xs text-red-400 hover:text-red-600 dark:hover:text-red-300"
        >
          Clear date
        </button>
      )}
    </div>
  );
}
