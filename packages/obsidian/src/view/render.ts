import { getEffectiveOwner, type AppState, type TaskWithLocation, type Workspace } from '@markdone/core';

export type GroupBy = 'project' | 'context' | 'owner';

export interface TaskRow {
  item: TaskWithLocation;
  workspaceId: string;
}

export interface TaskGroup {
  label: string;
  rows: TaskRow[];
}

function workspaceFor(state: AppState, workspaceId: string): Workspace | undefined {
  return state.workspaces.find(w => w.config.id === workspaceId);
}

// The group key(s) one task falls under. A context grouping can put a task
// in more than one group (it may carry several `@context`s); every other
// grouping is exactly one group.
function groupKeys(groupBy: GroupBy, item: TaskWithLocation, workspace: Workspace | undefined): string[] {
  const project = workspace?.todoFile.projects[item.location.projectIndex];
  switch (groupBy) {
    case 'project':
      return [project?.name ?? '(unknown project)'];
    case 'context':
      return item.task.contexts.length > 0 ? item.task.contexts : ['(no context)'];
    case 'owner': {
      const owner = project && workspace ? getEffectiveOwner(item.task, project, workspace) : undefined;
      return [owner ?? '(unowned)'];
    }
  }
}

export function groupTasks(state: AppState, tasks: TaskWithLocation[], groupBy: GroupBy): TaskGroup[] {
  const groups = new Map<string, TaskRow[]>();
  for (const item of tasks) {
    const workspace = workspaceFor(state, item.location.workspaceId);
    for (const key of groupKeys(groupBy, item, workspace)) {
      const rows = groups.get(key) ?? [];
      rows.push({ item, workspaceId: item.location.workspaceId });
      groups.set(key, rows);
    }
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, rows]) => ({ label, rows }));
}

// Every project reported as having no open task under a column named "Next"
// — a kanban project with nothing actionable there is stalled. Read-only
// helper for the view's header; not itself a grouping mode.
export function projectsStalledOnNext(state: AppState): string[] {
  const stalled: string[] = [];
  for (const workspace of state.workspaces) {
    for (const project of workspace.todoFile.projects) {
      if (project.layout !== 'kanban') continue;
      const nextColumn = project.sections.find(s => s.kind === 'column' && s.name === 'Next');
      if (nextColumn && nextColumn.kind === 'column') {
        const hasOpen = nextColumn.blocks.some(b => b.type === 'task' && b.task.checkbox.state === 'open');
        if (!hasOpen) stalled.push(project.name);
      }
    }
  }
  return stalled;
}

export interface TaskListCallbacks {
  onToggle: (row: TaskRow) => void;
  onOpenTask: (row: TaskRow) => void;
}

// Vanilla DOM only (no Obsidian `createEl`/`createDiv`/`empty` helpers) —
// this renders identically in the real app (where those helpers also exist
// on the same elements) and under a plain jsdom test, with nothing to fake.
export function renderTaskList(container: HTMLElement, groups: TaskGroup[], callbacks: TaskListCallbacks): void {
  const doc = container.ownerDocument;
  container.replaceChildren();

  if (groups.length === 0) {
    const empty = doc.createElement('p');
    empty.className = 'markdone-empty';
    empty.textContent = 'No open tasks.';
    container.append(empty);
    return;
  }

  for (const group of groups) {
    const section = doc.createElement('div');
    section.className = 'markdone-group';

    const heading = doc.createElement('h4');
    heading.textContent = `${group.label} (${group.rows.length})`;
    section.append(heading);

    const list = doc.createElement('ul');
    list.className = 'markdone-group-list';

    for (const row of group.rows) {
      list.append(renderTaskRow(doc, row, callbacks));
    }

    section.append(list);
    container.append(section);
  }
}

function renderTaskRow(doc: Document, row: TaskRow, callbacks: TaskListCallbacks): HTMLLIElement {
  const li = doc.createElement('li');
  li.className = 'markdone-task-row';

  const checkbox = doc.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = row.item.task.checkbox.state === 'done';
  checkbox.className = 'markdone-task-checkbox';
  checkbox.addEventListener('click', event => {
    event.preventDefault(); // the row re-renders once the mutation lands, not from a native toggle
    callbacks.onToggle(row);
  });
  li.append(checkbox);

  const label = doc.createElement('span');
  label.className = 'markdone-task-text';
  label.textContent = row.item.task.text;
  label.addEventListener('click', () => callbacks.onOpenTask(row));
  li.append(label);

  if (row.item.task.dueDate) {
    const due = doc.createElement('span');
    due.className = 'markdone-task-due';
    due.textContent = `!${row.item.task.dueDate}`;
    li.append(due);
  }

  return li;
}
