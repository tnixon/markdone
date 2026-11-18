import { parseCheckboxLine, tokenizeTaskLine, type CheckboxState } from '@markdone/core';

export interface TaskItemState {
  status: CheckboxState;
  waiting: boolean;
  deferred: boolean;
  contexts: string[];
}

// What a task line's styling hooks are derived from (data attributes and
// classes on the rendered item). `deferred` means "not actionable yet": an
// open task whose defer date is still in the future.
export function taskItemState(line: string, todayIso: string): TaskItemState | undefined {
  const cb = parseCheckboxLine(line);
  if (!cb) return undefined;
  const tokens = tokenizeTaskLine(cb.rest);
  const status = cb.checkbox.state;
  return {
    status,
    waiting: tokens.tags.some(tag => tag.type === 'nested' && tag.key === 'waiting'),
    deferred: status === 'open' && tokens.deferDate !== undefined && tokens.deferDate.slice(0, 10) > todayIso,
    contexts: tokens.contexts,
  };
}

// The heading a line sits under — its kanban column when the note is a
// board. The nearest preceding `## ` line, ignoring any inside a fenced code
// block (a `## ` there is code, not a heading); undefined above the first.
export function headingOfLine(lines: string[], lineNumber: number): string | undefined {
  let heading: string | undefined;
  let fence: string | undefined;
  for (let i = 0; i <= lineNumber && i < lines.length; i++) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(lines[i]);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === undefined) fence = marker;
      else if (fence === marker) fence = undefined;
      continue;
    }
    if (fence !== undefined) continue;
    const match = /^## (.*)$/.exec(lines[i]);
    if (match) heading = match[1].trim();
  }
  return heading;
}
