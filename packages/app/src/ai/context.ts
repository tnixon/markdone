/**
 * Assembles context (system prompt, workspace summary) before each API call.
 */

import type { AppState, Workspace } from '@markdone/core';
import { serialize, getTasks, getColumns, getColumnTasks, localDateString } from '@markdone/core';
import { buildSystemPrompt } from './systemPrompt';
import type { ContextScope } from './anthropicClient';

const TOKEN_BUDGET = 20_000; // approximate chars (1 token ≈ 4 chars)
const CHARS_PER_TOKEN = 4;
const MAX_CHARS = TOKEN_BUDGET * CHARS_PER_TOKEN;

function countTasks(workspace: Workspace): number {
  return workspace.todoFile.projects.reduce((total, project) => {
    if (project.layout === 'checklist') {
      return total + getTasks(project).length;
    }
    return total + getColumns(project).reduce((s, col) => s + getColumnTasks(col).length, 0);
  }, 0);
}

function serializeWorkspace(workspace: Workspace): string {
  return serialize(workspace.todoFile);
}

function workspaceSummary(workspace: Workspace): string {
  const taskCount = countTasks(workspace);
  const today = localDateString(new Date());
  let overdueCount = 0;
  for (const project of workspace.todoFile.projects) {
    const tasks =
      project.layout === 'checklist' ? getTasks(project) : getColumns(project).flatMap(c => getColumnTasks(c));
    for (const task of tasks) {
      if (!task.completed && task.dueDate && task.dueDate < today) {
        overdueCount++;
      }
    }
  }
  const parts = [`${taskCount} task${taskCount !== 1 ? 's' : ''}`];
  if (overdueCount > 0) parts.push(`${overdueCount} overdue`);
  return `[${parts.join(', ')}]`;
}

/**
 * Build the full system prompt with workspace context injected.
 */
export function assembleContext(
  state: AppState,
  scope: ContextScope,
  selectedWorkspaceId?: string,
): string {
  const workspaces = state.workspaces;
  if (workspaces.length === 0) {
    return buildSystemPrompt('No workspaces loaded.');
  }

  // Determine which workspaces to include in full
  const primaryIds =
    scope === 'current' && selectedWorkspaceId
      ? [selectedWorkspaceId]
      : workspaces.map(w => w.config.id);

  const sections: string[] = [];
  let totalChars = 0;

  // Serialize workspaces within budget
  for (const workspace of workspaces) {
    const isFull = primaryIds.includes(workspace.config.id);
    if (!isFull) {
      // Include a summary line for out-of-scope workspaces
      sections.push(
        `### Workspace: "${workspace.config.name}" (id: ${workspace.config.id}) ${workspaceSummary(workspace)}`,
      );
      continue;
    }

    const content = serializeWorkspace(workspace);
    const header = `### Workspace: "${workspace.config.name}" (id: ${workspace.config.id})\n\n`;

    if (totalChars + header.length + content.length > MAX_CHARS && sections.length > 0) {
      // Over budget — include summary instead
      sections.push(
        `### Workspace: "${workspace.config.name}" (id: ${workspace.config.id}) ${workspaceSummary(workspace)} [truncated — ask to focus on this workspace]`,
      );
    } else {
      sections.push(header + content);
      totalChars += header.length + content.length;
    }
  }

  return buildSystemPrompt(sections.join('\n\n'));
}
