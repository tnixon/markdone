import { localDateString } from '@markdone/core';

// The date the plugin's decorations treat as "today" (overdue and slack cues,
// the deferred state): the local calendar date, the same one core's
// operations stamp when a task is completed.
export function todayIso(now: Date = new Date()): string {
  return localDateString(now);
}
