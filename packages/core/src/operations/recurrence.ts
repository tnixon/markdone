// Next-occurrence arithmetic for `#every/<rule>` (spec: "#every/<rule>").
// Rule names match case-insensitively. Each instance is computed from the
// previous one, so a month-end clamp is not undone: a monthly task due
// Jan 31 becomes Feb 28, then Mar 28. Dates are plain `YYYY-MM-DD` with an optional `THH:MM` suffix that is
// preserved; all arithmetic is done in UTC so it can't drift with the host
// timezone.

const DATE_PART = /^(\d{4})-(\d{2})-(\d{2})/;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function toUtc(date: string): Date | undefined {
  const m = DATE_PART.exec(date);
  if (!m) return undefined;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addMonths(d: Date, months: number): Date {
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}

// Whether `rule` is one of the spec's valid recurrence rules.
export function isValidRecurrenceRule(rule: string): boolean {
  const lower = rule.toLowerCase();
  return /^(daily|weekly|monthly|yearly)$/.test(lower) || /^[1-9]\d*[dwmy]$/.test(lower) || WEEKDAYS.includes(lower);
}

// The date following `base` under `rule`, or undefined for an invalid rule or
// a malformed base. A weekday rule yields the next such weekday strictly
// after `base`.
export function nextOccurrence(rule: string, base: string): string | undefined {
  const start = toUtc(base);
  if (!start || !isValidRecurrenceRule(rule)) return undefined;
  const time = /T\d{2}:\d{2}$/.exec(base)?.[0] ?? '';

  let next: Date;
  const lower = rule.toLowerCase();
  if (lower === 'daily') next = addDays(start, 1);
  else if (lower === 'weekly') next = addDays(start, 7);
  else if (lower === 'monthly') next = addMonths(start, 1);
  else if (lower === 'yearly') next = addMonths(start, 12);
  else if (WEEKDAYS.includes(lower)) {
    const delta = (WEEKDAYS.indexOf(lower) - start.getUTCDay() + 7) % 7 || 7;
    next = addDays(start, delta);
  } else {
    const n = Number(lower.slice(0, -1));
    const unit = lower.slice(-1);
    next = unit === 'd' ? addDays(start, n) : unit === 'w' ? addDays(start, 7 * n) : unit === 'm' ? addMonths(start, n) : addMonths(start, 12 * n);
  }
  return formatDate(next) + time;
}
