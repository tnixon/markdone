import type { AppState, CheckboxState, Project, Task, Effort, Workspace } from '../model/types';
import type { TaskLocation } from './types';
import { localToday } from './utils';
import { getTasks, getColumns, getColumnTasks, getEffectiveOwner, isWaiting, getEnergy } from '../model/accessors';
import type { EnergyLevel } from '../model/accessors';

export type TaskWithLocation = {
  task: Task;
  location: TaskLocation;
  // The project the task belongs to. `path` is the project file's
  // workspace-relative path (directory mode only), so a caller can read the
  // project's frontmatter without re-implementing discovery.
  project: { name: string; path?: string };
};

export type EstimationBucket = {
  count: number;
  meanRatio: number;
  minRatio: number;
  maxRatio: number;
};

export type EstimationAccuracyStats = EstimationBucket & {
  tasks: Array<{ task: Task; location: TaskLocation; ratio: number }>;
  // Per-spec "Estimation Feedback": "Per-person: your estimates have been
  // within 20% for a month" and "Risk = complexity-bucketed estimate error".
  // Keyed by effective owner ('__unowned__' when none) and by
  // `String(task.complexity)` ('__none__' when unset).
  byOwner: Record<string, EstimationBucket>;
  byComplexity: Record<string, EstimationBucket>;
};

/**
 * Iterates all tasks (and subtasks) across all workspaces, yielding each with its location.
 * Does NOT include subtasks since they don't have their own TaskLocation.
 */
function* allTasksWithLocation(state: AppState): Iterable<TaskWithLocation> {
  for (const workspace of state.workspaces) {
    const workspaceId = workspace.config.id;
    for (let projectIndex = 0; projectIndex < workspace.todoFile.projects.length; projectIndex++) {
      const project = workspace.todoFile.projects[projectIndex];
      const projectRef = { name: project.name, ...(project.sourcePath !== undefined && { path: project.sourcePath }) };
      if (project.layout === 'checklist') {
        const tasks = getTasks(project);
        for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
          yield {
            task: tasks[taskIndex],
            location: { workspaceId, projectIndex, taskIndex },
            project: projectRef,
          };
        }
      } else {
        const columns = getColumns(project);
        for (let columnIndex = 0; columnIndex < columns.length; columnIndex++) {
          const tasks = getColumnTasks(columns[columnIndex]);
          for (let taskIndex = 0; taskIndex < tasks.length; taskIndex++) {
            yield {
              task: tasks[taskIndex],
              location: { workspaceId, projectIndex, columnIndex, taskIndex },
              project: projectRef,
            };
          }
        }
      }
    }
  }
}

function effortToMinutes(effort: Effort): number {
  switch (effort.unit) {
    case 'min': return effort.amount;
    case 'hrs': return effort.amount * 60;
    case 'days': return effort.amount * 60 * 8;
    case 'wks': return effort.amount * 60 * 8 * 5;
  }
}

function inScope(
  item: TaskWithLocation,
  workspaceId?: string,
  projectIndex?: number,
): boolean {
  if (workspaceId !== undefined && item.location.workspaceId !== workspaceId) return false;
  if (projectIndex !== undefined && item.location.projectIndex !== projectIndex) return false;
  return true;
}

export function findWorkspaceAndProject(state: AppState, location: TaskLocation): { workspace: Workspace; project: Project } {
  const workspace = state.workspaces.find(w => w.config.id === location.workspaceId)!;
  return { workspace, project: workspace.todoFile.projects[location.projectIndex] };
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

function summarizeRatios(entries: Array<{ ratio: number }>): EstimationBucket {
  const ratios = entries.map(e => e.ratio);
  return {
    count: ratios.length,
    meanRatio: ratios.reduce((a, b) => a + b, 0) / ratios.length,
    minRatio: ratios.reduce((a, b) => Math.min(a, b)),
    maxRatio: ratios.reduce((a, b) => Math.max(a, b)),
  };
}

// ---- Query Operations ----

export function getOverdueTasks(
  appState: AppState,
  asOfDate?: string,
): TaskWithLocation[] {
  const cutoff = asOfDate ?? localToday();
  const results: TaskWithLocation[] = [];

  for (const item of allTasksWithLocation(appState)) {
    if (!item.task.completed && item.task.dueDate && item.task.dueDate < cutoff) {
      results.push(item);
    }
  }

  return results;
}

export function getTasksDueInRange(
  appState: AppState,
  startDate: string,
  endDate: string,
): TaskWithLocation[] {
  const results: TaskWithLocation[] = [];

  for (const item of allTasksWithLocation(appState)) {
    if (
      !item.task.completed &&
      item.task.dueDate &&
      item.task.dueDate >= startDate &&
      item.task.dueDate <= endDate
    ) {
      results.push(item);
    }
  }

  return results;
}

export function getTasksByContext(appState: AppState, context: string): TaskWithLocation[] {
  const results: TaskWithLocation[] = [];

  for (const item of allTasksWithLocation(appState)) {
    if (item.task.contexts.includes(context)) {
      results.push(item);
    }
  }

  return results;
}

export function getTasksByTag(appState: AppState, tag: string): TaskWithLocation[] {
  const results: TaskWithLocation[] = [];

  for (const item of allTasksWithLocation(appState)) {
    const hasTag = item.task.tags.some(t =>
      t.type === 'label' ? t.name === tag : t.key === tag,
    );
    if (hasTag) {
      results.push(item);
    }
  }

  return results;
}

/**
 * Returns the highest value-to-complexity ratio incomplete task per context (GTD next actions).
 * Tasks with no context are grouped under the '__inbox__' key.
 * `scope` restricts the candidate pool to one workspace and/or project.
 */
export function getNextActions(
  appState: AppState,
  scope?: { workspaceId?: string; projectIndex?: number },
): Map<string, TaskWithLocation> {
  const byContext = new Map<string, TaskWithLocation>();

  for (const item of allTasksWithLocation(appState)) {
    if (!inScope(item, scope?.workspaceId, scope?.projectIndex)) continue;
    if (item.task.completed) continue;

    const ratio = (item.task.value ?? 1) / (item.task.complexity ?? 1);
    const contexts = item.task.contexts.length > 0 ? item.task.contexts : ['__inbox__'];

    for (const ctx of contexts) {
      const current = byContext.get(ctx);
      if (current === undefined) {
        byContext.set(ctx, item);
      } else {
        const currentRatio =
          (current.task.value ?? 1) / (current.task.complexity ?? 1);
        if (ratio > currentRatio) {
          byContext.set(ctx, item);
        }
      }
    }
  }

  return byContext;
}

export function getEstimationAccuracy(
  appState: AppState,
  workspaceId?: string,
  projectIndex?: number,
): EstimationAccuracyStats {
  const matching: Array<{ task: Task; location: TaskLocation; ratio: number; owner: string; complexity: string }> = [];

  for (const item of allTasksWithLocation(appState)) {
    if (!inScope(item, workspaceId, projectIndex)) continue;
    if (!item.task.completed) continue;
    if (!item.task.effort || !item.task.actual?.duration) continue;

    const estimatedMin = effortToMinutes(item.task.effort);
    const actualMin = effortToMinutes(item.task.actual.duration);
    if (estimatedMin === 0) continue;

    const ratio = actualMin / estimatedMin;
    const { workspace, project } = findWorkspaceAndProject(appState, item.location);
    matching.push({
      task: item.task,
      location: item.location,
      ratio,
      owner: getEffectiveOwner(item.task, project, workspace) ?? '__unowned__',
      complexity: item.task.complexity !== undefined ? String(item.task.complexity) : '__none__',
    });
  }

  if (matching.length === 0) {
    return { count: 0, meanRatio: 0, minRatio: 0, maxRatio: 0, tasks: [], byOwner: {}, byComplexity: {} };
  }

  const byOwner: Record<string, EstimationBucket> = {};
  for (const [owner, group] of groupBy(matching, m => m.owner)) byOwner[owner] = summarizeRatios(group);

  const byComplexity: Record<string, EstimationBucket> = {};
  for (const [complexity, group] of groupBy(matching, m => m.complexity)) byComplexity[complexity] = summarizeRatios(group);

  return {
    ...summarizeRatios(matching),
    tasks: matching.map(({ task, location, ratio }) => ({ task, location, ratio })),
    byOwner,
    byComplexity,
  };
}

export function searchTasks(appState: AppState, query: string): TaskWithLocation[] {
  const lower = query.toLowerCase();
  const results: TaskWithLocation[] = [];

  for (const item of allTasksWithLocation(appState)) {
    const inText = item.task.text.toLowerCase().includes(lower);
    const inTags = item.task.tags.some(t => {
      if (t.type === 'label') return t.name.toLowerCase().includes(lower);
      return t.key.toLowerCase().includes(lower) || t.value.toLowerCase().includes(lower);
    });

    if (inText || inTags) {
      results.push(item);
    }
  }

  return results;
}

export interface ListTasksFilters {
  workspaceId?: string;
  projectIndex?: number;
  context?: string;
  tag?: string;
  owner?: string;
  area?: string;
  checkboxState?: CheckboxState;
  dueBefore?: string;
  dueAfter?: string;
  // True for an open task whose deferDate is today or earlier (i.e. it's
  // become actionable); false to find tasks still deferred into the future.
  deferPassed?: boolean;
  waiting?: boolean;
}

/**
 * General-purpose task listing with independent, composable filters — the
 * catch-all query the more specific ones (getOverdueTasks, getTasksByTag,
 * ...) are special cases of.
 */
export function listTasks(
  appState: AppState,
  filters: ListTasksFilters = {},
  today: string = localToday(),
): TaskWithLocation[] {
  const results: TaskWithLocation[] = [];

  for (const item of allTasksWithLocation(appState)) {
    if (!inScope(item, filters.workspaceId, filters.projectIndex)) continue;
    if (filters.context !== undefined && !item.task.contexts.includes(filters.context)) continue;
    if (filters.checkboxState !== undefined && item.task.checkbox.state !== filters.checkboxState) continue;
    if (filters.dueBefore !== undefined && !(item.task.dueDate && item.task.dueDate < filters.dueBefore)) continue;
    if (filters.dueAfter !== undefined && !(item.task.dueDate && item.task.dueDate > filters.dueAfter)) continue;
    if (filters.waiting !== undefined && isWaiting(item.task) !== filters.waiting) continue;

    if (filters.tag !== undefined) {
      const hasTag = item.task.tags.some(t => (t.type === 'label' ? t.name === filters.tag : t.key === filters.tag));
      if (!hasTag) continue;
    }

    if (filters.deferPassed !== undefined) {
      const passed = item.task.checkbox.state === 'open' && !!item.task.deferDate && item.task.deferDate <= today;
      if (passed !== filters.deferPassed) continue;
    }

    if (filters.owner !== undefined || filters.area !== undefined) {
      const { workspace, project } = findWorkspaceAndProject(appState, item.location);
      if (filters.owner !== undefined && getEffectiveOwner(item.task, project, workspace) !== filters.owner) continue;
      if (filters.area !== undefined && project.frontmatter.recognized.area !== filters.area) continue;
    }

    results.push(item);
  }

  return results;
}

/** Incomplete tasks with any `#waiting/` tag. */
export function getWaitingFor(appState: AppState): TaskWithLocation[] {
  return listTasks(appState, { waiting: true, checkboxState: 'open' });
}

export type TaskScore = {
  // value × the project's frontmatter priority (default 1). Undefined
  // without a $value — there's nothing to scale.
  importance: number | undefined;
  // Slack in days: (due date − today) − effort. Negative means the deadline
  // is already unreachable. Computed only when both !due and ~effort are
  // present — per spec, a task missing either has no full slack figure; a
  // caller wanting a partial signal can read task.dueDate/task.effort
  // directly, which is the "unopinionated" framing the spec asks for.
  urgency: number | undefined;
  // Mean actual/estimate ratio among this workspace's completed tasks
  // sharing this task's % complexity — "complexity-bucketed estimate
  // error". Undefined with no complexity or no historical data for it.
  risk: number | undefined;
  // Raw fit signals — the format's job stops at exposing these; matching
  // them against "where the asker is right now" is consumer behavior.
  fit: { contexts: string[]; energy: EnergyLevel | undefined; owner: string | undefined };
};

function daysBetween(fromDate: string, toDate: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return (new Date(toDate).getTime() - new Date(fromDate).getTime()) / msPerDay;
}

/**
 * Urgency's slack figure (spec "Prioritization Model"): `(due − asOf) −
 * effort`, in days. Negative means the deadline is already unreachable.
 * Exported so a caller with a due date and an effort but no full `Project`/
 * `Workspace` context — an editor decoration, say — can still compute the
 * same figure `score()` uses, instead of re-deriving the formula.
 */
export function slackDays(dueDate: string, effort: Effort, asOf: string): number {
  return daysBetween(asOf, dueDate) - effortToMinutes(effort) / (60 * 8);
}

function meanActualToEstimateRatioForComplexity(workspace: Workspace, complexity: number): number | undefined {
  const ratios: number[] = [];
  for (const project of workspace.todoFile.projects) {
    const tasks = project.layout === 'checklist' ? getTasks(project) : getColumns(project).flatMap(getColumnTasks);
    for (const task of tasks) {
      if (task.complexity !== complexity || !task.completed || !task.effort || !task.actual?.duration) continue;
      const estimatedMin = effortToMinutes(task.effort);
      if (estimatedMin === 0) continue;
      ratios.push(effortToMinutes(task.actual.duration) / estimatedMin);
    }
  }
  return ratios.length > 0 ? ratios.reduce((a, b) => a + b, 0) / ratios.length : undefined;
}

/**
 * The four independent prioritization signals (spec: "Prioritization
 * Model") for one task. Computed only, never persisted — a consumer
 * combines these however it likes.
 */
export function score(task: Task, project: Project, workspace: Workspace, today: string = localToday()): TaskScore {
  const priority = typeof project.frontmatter.recognized.priority === 'number' ? project.frontmatter.recognized.priority : 1;
  const importance = task.value !== undefined ? task.value * priority : undefined;

  const urgency =
    task.dueDate !== undefined && task.effort !== undefined
      ? slackDays(task.dueDate, task.effort, today)
      : undefined;

  const risk = task.complexity !== undefined ? meanActualToEstimateRatioForComplexity(workspace, task.complexity) : undefined;

  const fit = {
    contexts: task.contexts,
    energy: getEnergy(task),
    owner: getEffectiveOwner(task, project, workspace),
  };

  return { importance, urgency, risk, fit };
}

/**
 * `score()` for a task addressed by its location in `state`, resolving the
 * project and workspace it needs. The one path both the `score` operation and
 * `listTasks`' `withScores` go through, so a task's score can't differ
 * between the two.
 */
export function scoreTaskAt(state: AppState, task: Task, location: TaskLocation, today?: string): TaskScore {
  const { workspace, project } = findWorkspaceAndProject(state, location);
  return score(task, project, workspace, today);
}

export type ScoredTaskWithLocation = TaskWithLocation & { score: TaskScore };

/** Each item with its `score` attached, all computed from `state` and one `today`. */
export function withScores(state: AppState, items: TaskWithLocation[], today?: string): ScoredTaskWithLocation[] {
  return items.map(item => ({ ...item, score: scoreTaskAt(state, item.task, item.location, today) }));
}
