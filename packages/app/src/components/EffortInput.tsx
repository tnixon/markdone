import React, { useState, useEffect } from 'react';
import type { Effort } from '@markdone/core';

interface EffortInputProps {
  value?: Effort;
  onChange: (effort: Effort | undefined) => void;
}

export default function EffortInput({ value, onChange }: EffortInputProps) {
  const [amountText, setAmountText] = useState(value?.amount?.toString() ?? '');

  useEffect(() => {
    setAmountText(value?.amount?.toString() ?? '');
  }, [value?.amount]);

  function handleAmountBlur() {
    const raw = amountText.trim();
    if (!raw) {
      onChange(undefined);
      return;
    }
    const amount = parseFloat(raw);
    if (isNaN(amount) || amount <= 0) return;
    onChange({ amount, unit: value?.unit ?? 'hrs' });
  }

  function handleUnitChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const unit = e.target.value as Effort['unit'];
    if (value) {
      onChange({ ...value, unit });
    }
  }

  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        min="0"
        step="0.5"
        value={amountText}
        onChange={e => setAmountText(e.target.value)}
        onBlur={handleAmountBlur}
        placeholder="amount"
        className="w-16 text-sm bg-transparent outline-none border-b border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 placeholder-gray-400 py-0.5"
      />
      <select
        value={value?.unit ?? 'hrs'}
        onChange={handleUnitChange}
        className="text-sm bg-transparent outline-none text-gray-600 dark:text-gray-400 border-b border-gray-300 dark:border-gray-600 py-0.5 cursor-pointer"
      >
        <option value="min">min</option>
        <option value="hrs">hrs</option>
        <option value="days">days</option>
        <option value="wks">wks</option>
      </select>
    </div>
  );
}
