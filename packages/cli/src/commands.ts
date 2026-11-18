import type { WorkspaceHandle } from '@markdone/core';
import type { ParsedFlags } from './flagsParser';
import { parseFlags, getFlag, getFlags, requireInt } from './flagsParser';
import { buildTaskRef, buildSubtaskRef, buildTaskInput, buildTaskChanges, parseEffort } from './refs';
import { resolveProjectIndex, pickTargetWorkspace, type ResolvedWorkspace } from './workspace';
import { UsageError } from './errors';

export interface CommandContext {
  resolved: ResolvedWorkspace[];
  owner?: string;
  inId?: string;
}

export interface QueryCommand {
  opName: string;
  usage: string;
  booleanFlags?: Set<string>;
  build(flags: ParsedFlags, ctx: CommandContext): Record<string, unknown>;
}

export interface MutationCommand {
  opName: string;
  usage: string;
  booleanFlags?: Set<string>;
  build(flags: ParsedFlags, ctx: CommandContext, handle: WorkspaceHandle, workspaceId: string): Record<string, unknown>;
}

function scopeToProject(flags: ParsedFlags, ctx: CommandContext): Record<string, unknown> {
  const project = getFlag(flags.values, 'project');
  const input: Record<string, unknown> = {};
  if (ctx.inId !== undefined) input.workspaceId = ctx.inId;
  if (project === undefined) return input;
  const target = pickTargetWorkspace(ctx.resolved, ctx.inId);
  const projectIndex = resolveProjectIndex(target.handle, project);
  if (projectIndex === undefined) throw new UsageError(`Unknown project '${project}'`);
  input.workspaceId = target.id;
  input.projectIndex = projectIndex;
  return input;
}

const LIST_BOOLEAN_FLAGS = new Set(['defer-passed', 'waiting', 'score']);

export const QUERY_COMMANDS: Record<string, QueryCommand> = {
  overdue: {
    opName: 'getOverdueTasks',
    usage: 'markdone overdue [--as-of YYYY-MM-DD]',
    build: flags => {
      const asOf = getFlag(flags.values, 'as-of');
      return asOf !== undefined ? { asOfDate: asOf } : {};
    },
  },
  due: {
    opName: 'getTasksDueInRange',
    usage: 'markdone due --start YYYY-MM-DD --end YYYY-MM-DD',
    build: flags => {
      const start = getFlag(flags.values, 'start');
      const end = getFlag(flags.values, 'end');
      if (!start || !end) throw new UsageError('--start and --end are required');
      return { startDate: start, endDate: end };
    },
  },
  context: {
    opName: 'getTasksByContext',
    usage: 'markdone context <name>',
    build: flags => {
      const context = flags.positionals[0];
      if (!context) throw new UsageError('Context name is required');
      return { context };
    },
  },
  tag: {
    opName: 'getTasksByTag',
    usage: 'markdone tag <name>',
    build: flags => {
      const tag = flags.positionals[0];
      if (!tag) throw new UsageError('Tag name is required');
      return { tag };
    },
  },
  next: {
    opName: 'getNextActions',
    usage: 'markdone next [--project <name|path|index>]',
    build: (flags, ctx) => scopeToProject(flags, ctx),
  },
  accuracy: {
    opName: 'getEstimationAccuracy',
    usage: 'markdone accuracy [--project <name|path|index>]',
    build: (flags, ctx) => scopeToProject(flags, ctx),
  },
  search: {
    opName: 'searchTasks',
    usage: 'markdone search <query>',
    build: flags => {
      const query = flags.positionals.join(' ');
      if (!query) throw new UsageError('Search query is required');
      return { query };
    },
  },
  list: {
    opName: 'listTasks',
    usage: 'markdone list [--project P] [--context C] [--tag T] [--area A] [--state open|done|cancelled|other] [--due-before D] [--due-after D] [--defer-passed|--no-defer-passed] [--waiting|--no-waiting] [--score] (--owner is global, see top-level usage). --score adds each row\'s importance/urgency/risk/fit, as `score` would return, in the same pass.',
    booleanFlags: LIST_BOOLEAN_FLAGS,
    build: (flags, ctx) => {
      const input = scopeToProject(flags, ctx);
      const context = getFlag(flags.values, 'context');
      if (context !== undefined) input.context = context;
      const tag = getFlag(flags.values, 'tag');
      if (tag !== undefined) input.tag = tag;
      // --owner is a global flag (parsed in run.ts), not a per-command one.
      if (ctx.owner !== undefined) input.owner = ctx.owner;
      const area = getFlag(flags.values, 'area');
      if (area !== undefined) input.area = area;
      const state = getFlag(flags.values, 'state');
      if (state !== undefined) input.checkboxState = state;
      const dueBefore = getFlag(flags.values, 'due-before');
      if (dueBefore !== undefined) input.dueBefore = dueBefore;
      const dueAfter = getFlag(flags.values, 'due-after');
      if (dueAfter !== undefined) input.dueAfter = dueAfter;
      if (flags.flags.has('defer-passed')) input.deferPassed = true;
      if (flags.flags.has('no-defer-passed')) input.deferPassed = false;
      if (flags.flags.has('waiting')) input.waiting = true;
      if (flags.flags.has('no-waiting')) input.waiting = false;
      if (flags.flags.has('score')) input.withScores = true;
      return input;
    },
  },
  waiting: {
    opName: 'getWaitingFor',
    usage: 'markdone waiting',
    build: () => ({}),
  },
  score: {
    opName: 'score',
    usage: 'markdone score (--task <^id> | --project <name|path|index> --index <n>)',
    build: (flags, ctx) => {
      const target = pickTargetWorkspace(ctx.resolved, ctx.inId);
      return { location: buildTaskRef(target.handle, target.id, flags) };
    },
  },
};

const ASSIGN_ID_FLAGS = new Set(['assign-id']);
const COLUMN_DELETE_FLAGS = new Set(['delete-tasks']);
const PROJECT_ADD_FLAGS = new Set(['folder']);

export const MUTATION_COMMANDS: Record<string, MutationCommand> = {
  add: {
    opName: 'addTask',
    usage: 'markdone add <text> --project <name|path|index> [--column <n>] [--due D] [--context C]... [--value N] [--complexity N] [--effort 2hrs] [--tag T]... [--no-assign-id]',
    booleanFlags: ASSIGN_ID_FLAGS,
    build: (flags, ctx, handle, workspaceId) => {
      const project = getFlag(flags.values, 'project');
      if (project === undefined) throw new UsageError('--project <name|path|index> is required');
      const projectIndex = resolveProjectIndex(handle, project);
      if (projectIndex === undefined) throw new UsageError(`Unknown project '${project}'`);
      const input: Record<string, unknown> = {
        workspaceId,
        projectIndex,
        task: buildTaskInput(flags, { requireText: true, owner: ctx.owner }),
      };
      const column = getFlag(flags.values, 'column');
      if (column !== undefined) input.columnIndex = requireInt(column, '--column');
      if (flags.flags.has('no-assign-id')) input.assignId = false;
      return input;
    },
  },
  update: {
    opName: 'updateTask',
    usage: 'markdone update (--task <^id> | --project P --index N) [--text T] [--due D] [--context C]... [--value N] [--complexity N] [--effort 2hrs] [--tag T]...',
    build: (flags, _ctx, handle, workspaceId) => ({
      location: buildTaskRef(handle, workspaceId, flags),
      changes: buildTaskChanges(flags),
    }),
  },
  rm: {
    opName: 'deleteTask',
    usage: 'markdone rm (--task <^id> | --project P --index N)',
    build: (flags, _ctx, handle, workspaceId) => ({ location: buildTaskRef(handle, workspaceId, flags) }),
  },
  done: {
    opName: 'completeTask',
    usage: 'markdone done (--task <^id> | --project P --index N) [--actual 2hrs]',
    build: (flags, _ctx, handle, workspaceId) => {
      const input: Record<string, unknown> = { location: buildTaskRef(handle, workspaceId, flags) };
      const actual = getFlag(flags.values, 'actual');
      if (actual !== undefined) input.actual = { duration: parseEffort(actual, '--actual') };
      return input;
    },
  },
  undone: {
    opName: 'uncompleteTask',
    usage: 'markdone undone (--task <^id> | --project P --index N)',
    build: (flags, _ctx, handle, workspaceId) => ({ location: buildTaskRef(handle, workspaceId, flags) }),
  },
  cancel: {
    opName: 'cancelTask',
    usage: 'markdone cancel (--task <^id> | --project P --index N)',
    build: (flags, _ctx, handle, workspaceId) => ({ location: buildTaskRef(handle, workspaceId, flags) }),
  },
  move: {
    opName: 'moveTask',
    usage: 'markdone move (--task <^id> | --project P --index N) --to-project P --to-index N [--to-column C] [--to-workspace ID]',
    build: (flags, ctx, handle, workspaceId) => {
      const from = buildTaskRef(handle, workspaceId, flags);
      const toWorkspaceId = getFlag(flags.values, 'to-workspace') ?? workspaceId;
      const toHandle = ctx.resolved.find(r => r.id === toWorkspaceId)?.handle;
      if (!toHandle) throw new UsageError(`No such workspace '${toWorkspaceId}' (see --to-workspace)`);
      const toProject = getFlag(flags.values, 'to-project');
      const toIndex = getFlag(flags.values, 'to-index');
      if (toProject === undefined || toIndex === undefined) {
        throw new UsageError('--to-project <name|path|index> and --to-index <n> are required');
      }
      const toProjectIndex = resolveProjectIndex(toHandle, toProject);
      if (toProjectIndex === undefined) throw new UsageError(`Unknown project '${toProject}'`);
      const to: Record<string, unknown> = { workspaceId: toWorkspaceId, projectIndex: toProjectIndex, taskIndex: requireInt(toIndex, '--to-index') };
      const toColumn = getFlag(flags.values, 'to-column');
      if (toColumn !== undefined) to.columnIndex = requireInt(toColumn, '--to-column');
      return { from, to };
    },
  },
  reorder: {
    opName: 'reorderTask',
    usage: 'markdone reorder (--task <^id> | --project P --index N) --new-index N',
    build: (flags, _ctx, handle, workspaceId) => {
      const newIndex = getFlag(flags.values, 'new-index');
      if (newIndex === undefined) throw new UsageError('--new-index <n> is required');
      return { location: buildTaskRef(handle, workspaceId, flags), newIndex: requireInt(newIndex, '--new-index') };
    },
  },
  'add-subtask': {
    opName: 'addSubtask',
    usage: 'markdone add-subtask <text> (--task <^id> | --project P --index N) [--due D] [--context C]... [--value N] [--complexity N] [--effort 2hrs] [--tag T]...',
    build: (flags, ctx, handle, workspaceId) => ({
      parentLocation: buildTaskRef(handle, workspaceId, flags),
      subtask: buildTaskInput(flags, { requireText: true, owner: ctx.owner }),
    }),
  },
  'update-subtask': {
    opName: 'updateSubtask',
    usage: 'markdone update-subtask (--task <^id> | --project P --index N --subtask N) [--text T] [--due D] ...',
    build: (flags, _ctx, handle, workspaceId) => ({
      location: buildSubtaskRef(handle, workspaceId, flags),
      changes: buildTaskChanges(flags),
    }),
  },
  'rm-subtask': {
    opName: 'deleteSubtask',
    usage: 'markdone rm-subtask (--task <^id> | --project P --index N --subtask N)',
    build: (flags, _ctx, handle, workspaceId) => ({ location: buildSubtaskRef(handle, workspaceId, flags) }),
  },
  'assign-ids': {
    opName: 'assignTaskIds',
    usage: 'markdone assign-ids',
    build: (_flags, _ctx, _handle, workspaceId) => ({ workspaceId }),
  },
  'project-add': {
    opName: 'addProject',
    usage: 'markdone project-add <name> --layout checklist|kanban [--description D] [--folder]',
    booleanFlags: PROJECT_ADD_FLAGS,
    build: (flags, _ctx, handle, workspaceId) => {
      const name = flags.positionals.join(' ');
      if (!name) throw new UsageError('Project name is required');
      // A file-mode workspace is one file of H1 projects: there is no folder
      // to put a project in, so say so rather than silently ignoring it.
      if (flags.flags.has('folder') && !handle.discoveryReport) {
        throw new UsageError('--folder applies to directory workspaces only (this workspace is a single file)');
      }
      const layout = getFlag(flags.values, 'layout');
      if (layout !== 'checklist' && layout !== 'kanban') throw new UsageError("--layout must be 'checklist' or 'kanban'");
      const input: Record<string, unknown> = { workspaceId, name, layout };
      const description = getFlag(flags.values, 'description');
      if (description !== undefined) input.description = description;
      // Directory mode: <name>/todo.md in its own folder instead of a root
      // <name>.md.
      if (flags.flags.has('folder')) input.folder = true;
      return input;
    },
  },
  'project-update': {
    opName: 'updateProject',
    usage: 'markdone project-update --project <name|path|index> [--name N] [--description D]',
    build: (flags, _ctx, handle, workspaceId) => {
      const project = getFlag(flags.values, 'project');
      if (project === undefined) throw new UsageError('--project <name|path|index> is required');
      const projectIndex = resolveProjectIndex(handle, project);
      if (projectIndex === undefined) throw new UsageError(`Unknown project '${project}'`);
      const changes: Record<string, unknown> = {};
      const name = getFlag(flags.values, 'name');
      if (name !== undefined) changes.name = name;
      const description = getFlag(flags.values, 'description');
      if (description !== undefined) changes.description = description;
      return { workspaceId, projectIndex, changes };
    },
  },
  'project-rm': {
    opName: 'deleteProject',
    usage: 'markdone project-rm --project <name|path|index>',
    build: (flags, _ctx, handle, workspaceId) => {
      const project = getFlag(flags.values, 'project');
      if (project === undefined) throw new UsageError('--project <name|path|index> is required');
      const projectIndex = resolveProjectIndex(handle, project);
      if (projectIndex === undefined) throw new UsageError(`Unknown project '${project}'`);
      return { workspaceId, projectIndex };
    },
  },
  'project-reorder': {
    opName: 'reorderProject',
    usage: 'markdone project-reorder --project <name|path|index> --new-index N',
    build: (flags, _ctx, handle, workspaceId) => {
      const project = getFlag(flags.values, 'project');
      const newIndex = getFlag(flags.values, 'new-index');
      if (project === undefined || newIndex === undefined) throw new UsageError('--project and --new-index are required');
      const projectIndex = resolveProjectIndex(handle, project);
      if (projectIndex === undefined) throw new UsageError(`Unknown project '${project}'`);
      return { workspaceId, projectIndex, newIndex: requireInt(newIndex, '--new-index') };
    },
  },
  'column-add': {
    opName: 'addColumn',
    usage: 'markdone column-add <name> --project <name|path|index> [--at N]',
    build: (flags, _ctx, handle, workspaceId) => {
      const project = getFlag(flags.values, 'project');
      if (project === undefined) throw new UsageError('--project <name|path|index> is required');
      const projectIndex = resolveProjectIndex(handle, project);
      if (projectIndex === undefined) throw new UsageError(`Unknown project '${project}'`);
      const columnName = flags.positionals.join(' ');
      if (!columnName) throw new UsageError('Column name is required');
      const input: Record<string, unknown> = { workspaceId, projectIndex, columnName };
      const at = getFlag(flags.values, 'at');
      if (at !== undefined) input.atIndex = requireInt(at, '--at');
      return input;
    },
  },
  'column-rename': {
    opName: 'renameColumn',
    usage: 'markdone column-rename --project <name|path|index> --column N --new-name NAME',
    build: (flags, _ctx, handle, workspaceId) => {
      const project = getFlag(flags.values, 'project');
      const column = getFlag(flags.values, 'column');
      const newName = getFlag(flags.values, 'new-name');
      if (project === undefined || column === undefined || newName === undefined) {
        throw new UsageError('--project, --column and --new-name are required');
      }
      const projectIndex = resolveProjectIndex(handle, project);
      if (projectIndex === undefined) throw new UsageError(`Unknown project '${project}'`);
      return { workspaceId, projectIndex, columnIndex: requireInt(column, '--column'), newName };
    },
  },
  'column-rm': {
    opName: 'deleteColumn',
    usage: 'markdone column-rm --project <name|path|index> --column N (--move-to N | --delete-tasks)',
    booleanFlags: COLUMN_DELETE_FLAGS,
    build: (flags, _ctx, handle, workspaceId) => {
      const project = getFlag(flags.values, 'project');
      const column = getFlag(flags.values, 'column');
      if (project === undefined || column === undefined) throw new UsageError('--project and --column are required');
      const projectIndex = resolveProjectIndex(handle, project);
      if (projectIndex === undefined) throw new UsageError(`Unknown project '${project}'`);
      const moveTo = getFlag(flags.values, 'move-to');
      const deleteTasks = flags.flags.has('delete-tasks');
      if (moveTo === undefined && !deleteTasks) throw new UsageError('Specify --move-to <n> or --delete-tasks');
      if (moveTo !== undefined && deleteTasks) throw new UsageError('Specify only one of --move-to or --delete-tasks');
      const moveTasks = deleteTasks ? 'delete' : { targetColumnIndex: requireInt(moveTo!, '--move-to') };
      return { workspaceId, projectIndex, columnIndex: requireInt(column, '--column'), moveTasks };
    },
  },
  'column-reorder': {
    opName: 'reorderColumn',
    usage: 'markdone column-reorder --project <name|path|index> --column N --new-index N',
    build: (flags, _ctx, handle, workspaceId) => {
      const project = getFlag(flags.values, 'project');
      const column = getFlag(flags.values, 'column');
      const newIndex = getFlag(flags.values, 'new-index');
      if (project === undefined || column === undefined || newIndex === undefined) {
        throw new UsageError('--project, --column and --new-index are required');
      }
      const projectIndex = resolveProjectIndex(handle, project);
      if (projectIndex === undefined) throw new UsageError(`Unknown project '${project}'`);
      return { workspaceId, projectIndex, columnIndex: requireInt(column, '--column'), newIndex: requireInt(newIndex, '--new-index') };
    },
  },
};

// Re-exported so run.ts can tokenize a command's remaining argv with the
// right boolean-flag set without importing flagsParser directly.
export { parseFlags, getFlags };

// Derived from the two tables above, not hand-maintained — so this can never
// drift from what QUERY_COMMANDS/MUTATION_COMMANDS actually define (a name
// written down twice, once here and once as a table key, could disagree with
// itself; a name computed from the tables can't). A test
// (commandCoverage.test.ts) asserts the derived result covers every
// non-batch registry operation exactly once, so a new core operation with no
// entry in either table fails the CLI suite instead of silently having no
// command.
export const COMMAND_NAMES: Record<string, string> = Object.fromEntries(
  [...Object.entries(QUERY_COMMANDS), ...Object.entries(MUTATION_COMMANDS)].map(([cliName, cmd]) => [cmd.opName, cliName]),
);
