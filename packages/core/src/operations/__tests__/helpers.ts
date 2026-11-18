import type { AppState, Block, ChecklistProject, Frontmatter, KanbanProject, Task, TodoFile } from '../../model/types';
import type { NewTaskInput } from '../types';

export const EMPTY_FRONTMATTER: Frontmatter = { raw: '', recognized: {}, unknown: {}, present: false };

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    text: 'Test task',
    checkbox: { state: 'open', marker: ' ' },
    completed: false,
    contexts: [],
    tags: [],
    subtasks: [],
    ...overrides,
  };
}

function toBlocks(tasks: Task[]): Block[] {
  return tasks.map(task => ({ type: 'task', task }));
}

export function makeChecklist(tasks: Partial<Task>[] = []): TodoFile {
  const project: ChecklistProject = {
    name: 'Test Project',
    layout: 'checklist',
    frontmatter: EMPTY_FRONTMATTER,
    blocks: toBlocks(tasks.map((t, i) => makeTask({ id: `task-${i + 1}`, ...t }))),
  };
  return { frontmatter: EMPTY_FRONTMATTER, preamble: [], projects: [project] };
}

export function makeKanban(
  columns: Array<{ name: string; tasks?: Partial<Task>[] }> = [
    { name: 'Todo' },
    { name: 'In Progress' },
    { name: 'Done' },
  ],
): TodoFile {
  let taskCounter = 0;
  const project: KanbanProject = {
    name: 'Test Board',
    layout: 'kanban',
    frontmatter: EMPTY_FRONTMATTER,
    preamble: [],
    sections: columns.map(col => ({
      kind: 'column',
      name: col.name,
      blocks: toBlocks((col.tasks ?? []).map(t => makeTask({ id: `task-${++taskCounter}`, ...t }))),
    })),
  };
  return { frontmatter: EMPTY_FRONTMATTER, preamble: [], projects: [project] };
}

export function makeAppState(workspaceId: string, todoFile: TodoFile): AppState {
  return {
    activeScope: workspaceId,
    workspaces: [
      {
        config: { id: workspaceId, name: 'Test Workspace', filePath: '/test.md' },
        todoFile,
      },
    ],
  };
}

export function makeMultiWorkspaceState(
  workspaces: Array<{ id: string; todoFile: TodoFile }>,
): AppState {
  return {
    activeScope: workspaces[0]?.id ?? 'ws1',
    workspaces: workspaces.map(w => ({
      config: { id: w.id, name: `Workspace ${w.id}`, filePath: `/${w.id}.md` },
      todoFile: w.todoFile,
    })),
  };
}

export const WORKSPACE_ID = 'ws1';

export const newTask: NewTaskInput = {
  text: 'New task',
  contexts: ['home'],
  tags: [{ type: 'label', name: 'urgent' }],
};
