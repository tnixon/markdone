import { TFile, type App } from 'obsidian';
import type { FileChange, WorkspaceHandle, OperationDefinition } from '@markdone/core';
import { ensureParentFolder } from './vaultFileSystem';

// A legitimate single-task mutation changes a small number of contiguous
// lines. A value far larger than that is the signature of the rebuildBlocks
// content-relocation defect (see the plan's "The blocker"): most of the
// file's lines end up in the "changed" span because they moved position,
// not because their content did. This is a coarse backstop, not a rigorous
// content-preservation proof — it stays in place even after that defect is
// fixed, per the plugin's standing etiquette rule (see the skill/README):
// a preview touching more than the targeted task is a signal to stop.
export const MAX_REASONABLE_CHANGED_LINES = 25;

// The size, in lines, of the "middle" span that still differs once common
// leading and trailing lines are excluded — the shortest possible
// description of what changed between two full-file texts.
export function changedLineSpan(before: string, after: string): number {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');

  let prefix = 0;
  const maxPrefix = Math.min(beforeLines.length, afterLines.length);
  while (prefix < maxPrefix && beforeLines[prefix] === afterLines[prefix]) prefix++;

  let suffix = 0;
  const maxSuffix = maxPrefix - prefix;
  while (
    suffix < maxSuffix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) {
    suffix++;
  }

  return Math.max(beforeLines.length - prefix - suffix, afterLines.length - prefix - suffix);
}

export interface WriteOutcome {
  path: string;
  applied: boolean;
  reason?: string;
  // The file changed between the read this write was computed from and the
  // write itself — the caller should reload what it has cached.
  conflict?: boolean;
}

async function writeOneChange(app: App, change: FileChange): Promise<WriteOutcome> {
  const { path, before, after } = change;

  if (after === null) {
    const entry = app.vault.getAbstractFileByPath(path);
    if (!entry) return { path, applied: false, reason: `"${path}" no longer exists` };
    await app.fileManager.trashFile(entry);
    return { path, applied: true };
  }

  if (before === null) {
    if (app.vault.getAbstractFileByPath(path)) {
      return { path, applied: false, reason: `"${path}" already exists — expected to create it` };
    }
    await ensureParentFolder(app, path);
    await app.vault.create(path, after);
    return { path, applied: true };
  }

  const span = changedLineSpan(before, after);
  if (span > MAX_REASONABLE_CHANGED_LINES) {
    return {
      path,
      applied: false,
      reason:
        `refusing to write "${path}": this change touches ${span} lines, well beyond a single ` +
        'task — it looks like unrelated content moved rather than the targeted edit',
    };
  }

  const file = app.vault.getAbstractFileByPath(path);
  if (!(file instanceof TFile)) return { path, applied: false, reason: `"${path}" is not a file` };

  // vault.process is Obsidian's atomic read-modify-write: the callback sees
  // the file's CURRENT content, not the (possibly stale) `before` this
  // change was computed against. Comparing the two here is the re-read-
  // before-mutate check — a mismatch means a concurrent edit landed between
  // the preview and this write, so we leave the file untouched and report it
  // rather than overwriting someone else's change.
  let concurrentEdit = false;
  await app.vault.process(file, data => {
    if (data !== before) {
      concurrentEdit = true;
      return data;
    }
    return after;
  });
  if (concurrentEdit) {
    return {
      path,
      applied: false,
      conflict: true,
      reason: `"${path}" was modified since the preview was computed — reload and try again`,
    };
  }
  return { path, applied: true };
}

// Applies a preview's changes one file at a time, stopping at the first one
// it can't apply. Changes already written stay written — the same
// non-atomicity `DirectoryWorkspaceHandle.applyOperation` itself has across
// multiple files, not something this makes worse.
export async function writePreviewedChanges(app: App, changes: FileChange[]): Promise<WriteOutcome[]> {
  const outcomes: WriteOutcome[] = [];
  for (const change of changes) {
    const outcome = await writeOneChange(app, change);
    outcomes.push(outcome);
    if (!outcome.applied) break;
  }
  return outcomes;
}

export type MutationResult = { ok: true } | { ok: false; message: string };

// The plugin's standard path for a task mutation: preview through core
// (which writes nothing), apply the result ourselves through Obsidian's
// vault API (never `WorkspaceHandle.applyOperation`, which always does a
// whole-file `fs.write` with no chance to guard the diff's shape first or
// use `vault.process`'s atomicity), then reload the handle so its next read
// reflects what was just written.
export async function previewAndApply(
  app: App,
  handle: WorkspaceHandle,
  op: OperationDefinition,
  input: Record<string, unknown>,
): Promise<MutationResult> {
  const preview = await handle.previewOperation(op, input);
  if (!preview.ok) return { ok: false, message: preview.error.message };

  const outcomes = await writePreviewedChanges(app, preview.value.changes);
  const failed = outcomes.find(o => !o.applied);
  if (failed) return { ok: false, message: failed.reason ?? `failed to write "${failed.path}"` };

  await handle.reload();
  return { ok: true };
}
