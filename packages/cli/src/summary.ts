import type { AppState } from '@markdone/core';
import { getOverdueTasks, getTasksDueInRange, getWaitingFor, listTasks, getColumns, getColumnTasks } from '@markdone/core';

export interface SummaryOptions {
  waitingDays: number;
  asOfDate: string; // the caller's local "today" unless --as-of overrides it
}

export interface ProjectSummary {
  workspaceId: string;
  projectIndex: number;
  name: string;
  // The project file's workspace-relative path (directory mode only), so a
  // caller can read the project's frontmatter without re-implementing
  // discovery.
  path?: string;
  openCount: number;
}

export interface StaleWaiting {
  text: string;
  workspaceId: string;
  // null = no follow-up date at all (also reported as stale)
  daysStale: number | null;
}

export interface SummaryResult {
  asOfDate: string;
  projects: ProjectSummary[];
  overdueCount: number;
  dueThisWeekCount: number;
  staleWaiting: StaleWaiting[];
  // "workspaceId/Project Name" for kanban projects whose Next column has no
  // open task — the GTD convention (spec: "Recommended Columns").
  projectsWithoutNext: string[];
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

function daysBetween(from: string, to: string): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / msPerDay);
}

export function buildSummary(state: AppState, options: SummaryOptions): SummaryResult {
  const { asOfDate } = options;
  const weekEnd = addDays(asOfDate, 7);

  const projects: ProjectSummary[] = [];
  const projectsWithoutNext: string[] = [];

  for (const workspace of state.workspaces) {
    workspace.todoFile.projects.forEach((project, projectIndex) => {
      const openTasks = listTasks(state, { workspaceId: workspace.config.id, projectIndex, checkboxState: 'open' });
      projects.push({
        workspaceId: workspace.config.id,
        projectIndex,
        name: project.name,
        ...(project.sourcePath !== undefined && { path: project.sourcePath }),
        openCount: openTasks.length,
      });

      if (project.layout === 'kanban') {
        const nextColumn = getColumns(project).find(c => c.name.toLowerCase() === 'next');
        // No Next column at all is the case most worth surfacing — it's
        // silently indistinguishable from "handled" unless checked for
        // explicitly, since the empty-column check below only fires when
        // the column exists.
        const missingNext = !nextColumn;
        const emptyNext = nextColumn && !getColumnTasks(nextColumn).some(t => t.checkbox.state === 'open');
        if (missingNext || emptyNext) {
          projectsWithoutNext.push(`${workspace.config.id}/${project.name}`);
        }
      }
    });
  }

  const overdueCount = getOverdueTasks(state, asOfDate).length;
  const dueThisWeekCount = getTasksDueInRange(state, asOfDate, weekEnd).length;

  const staleWaiting = getWaitingFor(state)
    .map(item => ({
      text: item.task.text,
      workspaceId: item.location.workspaceId,
      daysStale: item.task.dueDate ? daysBetween(item.task.dueDate, asOfDate) : null,
    }))
    .filter(w => w.daysStale === null || w.daysStale > options.waitingDays);

  return { asOfDate, projects, overdueCount, dueThisWeekCount, staleWaiting, projectsWithoutNext };
}

export function renderSummary(summary: SummaryResult): string {
  const lines: string[] = [`Summary as of ${summary.asOfDate}`, ''];

  lines.push('Open tasks by project:');
  if (summary.projects.length === 0) {
    lines.push('  (no projects)');
  } else {
    for (const p of summary.projects) lines.push(`  ${p.workspaceId}/${p.name}: ${p.openCount}`);
  }

  lines.push('', `Overdue: ${summary.overdueCount}`, `Due this week: ${summary.dueThisWeekCount}`);

  lines.push('', `Stale waiting-fors (older follow-up or none): ${summary.staleWaiting.length}`);
  for (const w of summary.staleWaiting) {
    lines.push(`  [${w.workspaceId}] ${w.text}${w.daysStale === null ? ' (no follow-up date)' : ` (${w.daysStale}d stale)`}`);
  }

  lines.push('', `Projects with no open task under Next: ${summary.projectsWithoutNext.length}`);
  for (const name of summary.projectsWithoutNext) lines.push(`  ${name}`);

  return lines.join('\n');
}
