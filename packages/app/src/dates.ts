import { localDateString } from '@markdone/core';

// The local calendar date, the same one core's operations treat as "today" —
// not `toISOString()`, which is the UTC date.
export function today(): string {
  return localDateString(new Date());
}

export function endOfWeek(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const dayOfWeek = d.getDay();
  const daysUntilSunday = dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
  d.setDate(d.getDate() + daysUntilSunday);
  return localDateString(d);
}
