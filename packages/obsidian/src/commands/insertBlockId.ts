import type { Editor } from 'obsidian';
import { locateTaskLineTokens, parseCheckboxLine } from '@markdone/core';

// Charset and shape match core's own id minting (taskOps.ts's
// generateBlockId, not on the barrel) — reimplemented here because this is
// a single-line editor transaction, not a workspace-wide mutation.
// `assignTaskIds` (the operation) would be the wrong tool for one line: it
// rewrites the whole file through the preview/write path for a change this
// command can make with `editor.setLine` alone.
function generateBlockId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export type InsertBlockIdResult = 'inserted' | 'not-a-task' | 'already-has-id';

// "Insert ^id on current task". Confirms the cursor's line is a task line
// (via the same `parseCheckboxLine` core itself uses, not a hand-rolled
// regex) and that it doesn't already have one, then appends. Nothing else
// on the line moves.
export function insertBlockIdOnCurrentLine(editor: Editor): InsertBlockIdResult {
  const lineNumber = editor.getCursor().line;
  const lineText = editor.getLine(lineNumber);

  const cb = parseCheckboxLine(lineText);
  if (!cb) return 'not-a-task';

  const hasId = locateTaskLineTokens(cb.rest).some(token => token.kind === 'blockId');
  if (hasId) return 'already-has-id';

  editor.setLine(lineNumber, `${lineText} ^${generateBlockId()}`);
  return 'inserted';
}
