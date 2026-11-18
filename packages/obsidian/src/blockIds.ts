import type { App } from 'obsidian';
import { getOperation, getColumnTasks, getColumns, getTasks, type Task, type WorkspaceHandle } from '@markdone/core';
import { previewAndApply } from './write';

function countMissingIds(task: Task): number {
  const own = task.blockId ? 0 : 1;
  return task.subtasks.reduce((sum, st) => sum + countMissingIds(st), own);
}

function countMissingBlockIds(handle: WorkspaceHandle): number {
  let count = 0;
  for (const project of handle.listProjects()) {
    const tasks = project.layout === 'checklist' ? getTasks(project) : getColumns(project).flatMap(getColumnTasks);
    for (const task of tasks) count += countMissingIds(task);
  }
  return count;
}

// After every reload — initial load and each debounced vault-event reload —
// ensures every task in the workspace has a `^id`. `^id` can't be REQUIRED
// by the format (spec: "Block IDs are optional. A task without one simply
// cannot be depended upon" — a hand-typed `- [ ] buy milk` is a valid task),
// so the plugin establishes it as its own invariant instead: by the time
// anything downstream (the view's click-to-open, its checkbox) runs, every
// task already has one. One behavior, no alternate paths: no banner, no
// confirmation prompt, no setting to turn it off.
//
// Goes through the normal preview+write path (`previewAndApply`), so a
// corrupting diff is refused by the same size guard as any other mutation
// — see write.ts's `changedLineSpan` check, the backstop against
// rebuildBlocks' content-relocation defect. Logs rather than notifying:
// this runs unattended on every file change, and a Notice for it would be
// noise the user didn't ask for.
export async function reconcileBlockIds(app: App, handle: WorkspaceHandle, workspaceLabel: string): Promise<void> {
  const missing = countMissingBlockIds(handle);
  if (missing === 0) return;

  const assignTaskIds = getOperation('assignTaskIds')!;
  const result = await previewAndApply(app, handle, assignTaskIds, { workspaceId: handle.id });

  if (result.ok) {
    console.log(`Markdone: assigned ${missing} block id${missing === 1 ? '' : 's'} in "${workspaceLabel}"`);
  } else {
    console.warn(`Markdone: could not assign block ids in "${workspaceLabel}": ${result.message}`);
  }
}
