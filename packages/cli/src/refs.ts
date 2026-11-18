import type { Effort, Tag } from '@markdone/core';
import type { WorkspaceHandle } from '@markdone/core';
import type { ParsedFlags } from './flagsParser';
import { getFlag, getFlags, requireInt, requireNumber } from './flagsParser';
import { resolveProjectIndex } from './workspace';
import { UsageError } from './errors';

// A task/subtask reference: --task <^id> (a stable TaskAddress, resolved by
// the operations layer at execution time), or --project <name|path|index>
// --index <n> [--column <n>] (a positional TaskLocation). Every ref still
// needs a workspaceId — even the address form, since ^id is only unique
// within one workspace (spec) — supplied by the caller, already resolved via
// pickTargetWorkspace.
export function buildTaskRef(handle: WorkspaceHandle, workspaceId: string, flags: ParsedFlags): Record<string, unknown> {
  const task = getFlag(flags.values, 'task');
  if (task !== undefined) return { workspaceId, taskId: task };
  return buildTaskLocation(handle, workspaceId, flags);
}

export function buildTaskLocation(handle: WorkspaceHandle, workspaceId: string, flags: ParsedFlags): Record<string, unknown> {
  const project = getFlag(flags.values, 'project');
  const index = getFlag(flags.values, 'index');
  if (project === undefined || index === undefined) {
    throw new UsageError('Specify --task <^id>, or --project <name|path|index> --index <n> [--column <n>]');
  }
  const projectIndex = resolveProjectIndex(handle, project);
  if (projectIndex === undefined) throw new UsageError(`Unknown project '${project}'`);
  const location: Record<string, unknown> = { workspaceId, projectIndex, taskIndex: requireInt(index, '--index') };
  const column = getFlag(flags.values, 'column');
  if (column !== undefined) location.columnIndex = requireInt(column, '--column');
  return location;
}

export function buildSubtaskRef(handle: WorkspaceHandle, workspaceId: string, flags: ParsedFlags): Record<string, unknown> {
  const task = getFlag(flags.values, 'task');
  if (task !== undefined) return { workspaceId, taskId: task };
  const location = buildTaskLocation(handle, workspaceId, flags);
  const subtask = getFlag(flags.values, 'subtask');
  if (subtask === undefined) {
    throw new UsageError('Specify --subtask <n> alongside --project/--index, or use --task <^id>');
  }
  return { ...location, subtaskIndex: requireInt(subtask, '--subtask') };
}

// flagName is whichever flag the caller parsed this out of (--effort for a
// new/updated task's estimate, --actual for a completion's recorded
// duration) — same grammar, different flag, so the error names the one the
// user actually typed.
export function parseEffort(spec: string, flagName = '--effort'): Effort {
  const match = /^(\d+(?:\.\d+)?)(min|hrs|days|wks)$/.exec(spec);
  if (!match) throw new UsageError(`Invalid ${flagName} '${spec}' — expected <amount><min|hrs|days|wks>, e.g. 2hrs`);
  return { amount: Number(match[1]), unit: match[2] as Effort['unit'] };
}

// "name" is a plain #name tag; "key/value" is a nested #key/value tag.
export function parseTags(specs: string[]): Tag[] {
  return specs.map(spec => {
    const slash = spec.indexOf('/');
    if (slash > 0) return { type: 'nested' as const, key: spec.slice(0, slash), value: spec.slice(slash + 1) };
    return { type: 'label' as const, name: spec };
  });
}

// Shared by `add`/`add-subtask` (a NewTaskInput; text required) and
// `update`/`update-subtask` (a partial TaskFields; only given fields are
// set — the operation itself is documented to leave the rest unchanged).
// `owner` folds the global --owner into a #owner/ tag on a newly created
// task, unless the caller already gave one explicitly via --tag.
export function buildTaskInput(flags: ParsedFlags, options: { requireText: boolean; owner?: string }): Record<string, unknown> {
  const positionalText = flags.positionals.join(' ') || undefined;
  const textFlag = getFlag(flags.values, 'text');
  if (positionalText !== undefined && textFlag !== undefined) {
    throw new UsageError('Give the task text either as a positional argument or via --text, not both');
  }
  const text = textFlag ?? positionalText;
  if (text === '') throw new UsageError('Task text must not be empty');
  if (options.requireText && text === undefined) throw new UsageError('Task text is required (as a positional argument or via --text)');

  const tags = parseTags(getFlags(flags.values, 'tag'));
  if (options.owner !== undefined && !tags.some(t => t.type === 'nested' && t.key === 'owner')) {
    tags.push({ type: 'nested', key: 'owner', value: options.owner });
  }

  const input: Record<string, unknown> = {};
  if (text !== undefined) input.text = text;
  const due = getFlag(flags.values, 'due');
  if (due !== undefined) input.dueDate = due;
  const contexts = getFlags(flags.values, 'context');
  if (contexts.length > 0) input.contexts = contexts;
  const value = getFlag(flags.values, 'value');
  if (value !== undefined) input.value = requireNumber(value, '--value');
  const complexity = getFlag(flags.values, 'complexity');
  if (complexity !== undefined) input.complexity = requireNumber(complexity, '--complexity');
  const effort = getFlag(flags.values, 'effort');
  if (effort !== undefined) input.effort = parseEffort(effort);
  if (tags.length > 0) input.tags = tags;
  return input;
}

// The input for `update`/`update-subtask`: at least one field must change, so
// an update that would silently do nothing is reported instead.
export function buildTaskChanges(flags: ParsedFlags): Record<string, unknown> {
  const changes = buildTaskInput(flags, { requireText: false });
  if (Object.keys(changes).length === 0) {
    throw new UsageError('Nothing to update — pass at least one of --text, --due, --context, --value, --complexity, --effort, --tag');
  }
  return changes;
}
