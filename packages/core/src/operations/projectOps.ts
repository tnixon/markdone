import type { AppState, ChecklistProject, KanbanProject, Project, TodoFile } from '../model/types';
import type { Result } from './types';
import { ok, err, resolveWorkspace, resolveProject, updateWorkspace } from './utils';
import { getColumns, getColumnTasks, setDescription, insertColumn, renameColumnAt, removeColumnAt, reorderColumnAt } from '../model/accessors';

const INBOX_NAME = 'Inbox';
const EMPTY_FRONTMATTER = { raw: '', recognized: {}, unknown: {}, present: false };

function replaceProject(todoFile: TodoFile, projectIndex: number, project: Project): TodoFile {
  return {
    ...todoFile,
    projects: todoFile.projects.map((p, i) => (i === projectIndex ? project : p)),
  };
}

// ---- Project Operations ----

export function addProject(
  state: AppState,
  workspaceId: string,
  name: string,
  layout: 'checklist' | 'kanban',
  description?: string,
): Result<AppState> {
  if (name.toLowerCase() === INBOX_NAME.toLowerCase()) {
    return err('RESERVED_NAME', '"Inbox" is a reserved project name');
  }

  const wsResult = resolveWorkspace(state, workspaceId);
  if (!wsResult.ok) return wsResult;

  let newProject: Project;
  if (layout === 'checklist') {
    const project: ChecklistProject = { layout: 'checklist', name, frontmatter: EMPTY_FRONTMATTER, blocks: [] };
    newProject = description !== undefined ? setDescription(project, description) : project;
  } else {
    const project: KanbanProject = {
      layout: 'kanban',
      name,
      frontmatter: EMPTY_FRONTMATTER,
      preamble: [],
      sections: [
        { kind: 'column', name: 'Todo', blocks: [] },
        { kind: 'column', name: 'In Progress', blocks: [] },
        { kind: 'column', name: 'Done', blocks: [] },
      ],
    };
    newProject = description !== undefined ? setDescription(project, description) : project;
  }

  const oldTf = wsResult.value.workspace.todoFile;
  const newTodoFile: TodoFile = { ...oldTf, projects: [...oldTf.projects, newProject] };

  return ok(updateWorkspace(state, workspaceId, newTodoFile));
}

export function updateProject(
  state: AppState,
  workspaceId: string,
  projectIndex: number,
  changes: { name?: string; description?: string },
): Result<AppState> {
  const wsResult = resolveWorkspace(state, workspaceId);
  if (!wsResult.ok) return wsResult;

  const { projects } = wsResult.value.workspace.todoFile;
  if (projects[projectIndex]?.name.toLowerCase() === INBOX_NAME.toLowerCase()) {
    return err('PROTECTED_PROJECT', 'The Inbox project cannot be modified');
  }
  if (changes.name?.toLowerCase() === INBOX_NAME.toLowerCase()) {
    return err('RESERVED_NAME', '"Inbox" is a reserved project name');
  }

  const projResult = resolveProject(wsResult.value.workspace, projectIndex);
  if (!projResult.ok) return projResult;

  let updatedProject: Project = projResult.value;
  if (changes.name !== undefined) updatedProject = { ...updatedProject, name: changes.name };
  if (changes.description !== undefined) updatedProject = setDescription(updatedProject, changes.description);

  const newTodoFile = replaceProject(wsResult.value.workspace.todoFile, projectIndex, updatedProject);
  return ok(updateWorkspace(state, workspaceId, newTodoFile));
}

export function deleteProject(
  state: AppState,
  workspaceId: string,
  projectIndex: number,
): Result<AppState> {
  const wsResult = resolveWorkspace(state, workspaceId);
  if (!wsResult.ok) return wsResult;

  const { projects } = wsResult.value.workspace.todoFile;
  if (projects[projectIndex]?.name.toLowerCase() === INBOX_NAME.toLowerCase()) {
    return err('PROTECTED_PROJECT', 'The Inbox project cannot be deleted');
  }
  if (projectIndex < 0 || projectIndex >= projects.length) {
    return err('PROJECT_NOT_FOUND', `Project at index ${projectIndex} not found`);
  }

  const oldTf = wsResult.value.workspace.todoFile;
  const newTodoFile: TodoFile = { ...oldTf, projects: oldTf.projects.filter((_, i) => i !== projectIndex) };

  return ok(updateWorkspace(state, workspaceId, newTodoFile));
}

export function reorderProject(
  state: AppState,
  workspaceId: string,
  projectIndex: number,
  newIndex: number,
): Result<AppState> {
  const wsResult = resolveWorkspace(state, workspaceId);
  if (!wsResult.ok) return wsResult;

  const { projects } = wsResult.value.workspace.todoFile;

  if (projects[projectIndex]?.name.toLowerCase() === INBOX_NAME.toLowerCase()) {
    return err('PROTECTED_PROJECT', 'The Inbox project cannot be reordered');
  }
  if (newIndex === 0 && projects[0]?.name.toLowerCase() === INBOX_NAME.toLowerCase()) {
    return err('PROTECTED_PROJECT', 'Cannot move a project to Inbox position');
  }
  if (projectIndex < 0 || projectIndex >= projects.length) {
    return err('PROJECT_NOT_FOUND', `Project at index ${projectIndex} not found`);
  }
  if (newIndex < 0 || newIndex >= projects.length) {
    return err('INDEX_OUT_OF_BOUNDS', `New index ${newIndex} is out of bounds`);
  }

  const updated = [...projects];
  const [removed] = updated.splice(projectIndex, 1);
  updated.splice(newIndex, 0, removed);

  const newTodoFile: TodoFile = { ...wsResult.value.workspace.todoFile, projects: updated };
  return ok(updateWorkspace(state, workspaceId, newTodoFile));
}

export function addColumn(
  state: AppState,
  workspaceId: string,
  projectIndex: number,
  columnName: string,
  atIndex?: number,
): Result<AppState> {
  const wsResult = resolveWorkspace(state, workspaceId);
  if (!wsResult.ok) return wsResult;

  const projResult = resolveProject(wsResult.value.workspace, projectIndex);
  if (!projResult.ok) return projResult;
  if (projResult.value.layout !== 'kanban') {
    return err('NOT_KANBAN_PROJECT', 'Cannot add column to a checklist project');
  }

  const updatedProject = insertColumn(projResult.value, columnName, atIndex);
  const newTodoFile = replaceProject(wsResult.value.workspace.todoFile, projectIndex, updatedProject);
  return ok(updateWorkspace(state, workspaceId, newTodoFile));
}

export function renameColumn(
  state: AppState,
  workspaceId: string,
  projectIndex: number,
  columnIndex: number,
  newName: string,
): Result<AppState> {
  const wsResult = resolveWorkspace(state, workspaceId);
  if (!wsResult.ok) return wsResult;

  const projResult = resolveProject(wsResult.value.workspace, projectIndex);
  if (!projResult.ok) return projResult;
  if (projResult.value.layout !== 'kanban') {
    return err('NOT_KANBAN_PROJECT', 'Cannot rename column on a checklist project');
  }

  const columns = getColumns(projResult.value);
  if (columnIndex < 0 || columnIndex >= columns.length) {
    return err('COLUMN_NOT_FOUND', `Column at index ${columnIndex} not found`);
  }

  const updatedProject = renameColumnAt(projResult.value, columnIndex, newName);
  const newTodoFile = replaceProject(wsResult.value.workspace.todoFile, projectIndex, updatedProject);
  return ok(updateWorkspace(state, workspaceId, newTodoFile));
}

export function deleteColumn(
  state: AppState,
  workspaceId: string,
  projectIndex: number,
  columnIndex: number,
  moveTasks: 'delete' | { targetColumnIndex: number },
): Result<AppState> {
  const wsResult = resolveWorkspace(state, workspaceId);
  if (!wsResult.ok) return wsResult;

  const projResult = resolveProject(wsResult.value.workspace, projectIndex);
  if (!projResult.ok) return projResult;
  if (projResult.value.layout !== 'kanban') {
    return err('NOT_KANBAN_PROJECT', 'Cannot delete column on a checklist project');
  }

  const project = projResult.value;
  const columns = getColumns(project);

  if (columnIndex < 0 || columnIndex >= columns.length) {
    return err('COLUMN_NOT_FOUND', `Column at index ${columnIndex} not found`);
  }
  if (columns.length === 1) {
    return err('INVALID_COLUMN_OPERATION', 'Cannot delete the last column of a kanban project');
  }

  let updatedProject: KanbanProject;
  if (moveTasks === 'delete') {
    updatedProject = removeColumnAt(project, columnIndex);
  } else {
    const { targetColumnIndex } = moveTasks;
    if (targetColumnIndex < 0 || targetColumnIndex >= columns.length) {
      return err('COLUMN_NOT_FOUND', `Target column at index ${targetColumnIndex} not found`);
    }
    if (targetColumnIndex === columnIndex) {
      return err('INVALID_COLUMN_OPERATION', 'Target column cannot be the same as the deleted column');
    }
    const tasksToMove = getColumnTasks(columns[columnIndex]);
    const targetName = columns[targetColumnIndex].name;

    const removed = removeColumnAt(project, columnIndex);
    const sections = removed.sections.map(s =>
      s.kind === 'column' && s.name === targetName
        ? { ...s, blocks: [...s.blocks, ...tasksToMove.map(t => ({ type: 'task' as const, task: t }))] }
        : s,
    );
    updatedProject = { ...removed, sections };
  }

  const newTodoFile = replaceProject(wsResult.value.workspace.todoFile, projectIndex, updatedProject);
  return ok(updateWorkspace(state, workspaceId, newTodoFile));
}

export function reorderColumn(
  state: AppState,
  workspaceId: string,
  projectIndex: number,
  columnIndex: number,
  newIndex: number,
): Result<AppState> {
  const wsResult = resolveWorkspace(state, workspaceId);
  if (!wsResult.ok) return wsResult;

  const projResult = resolveProject(wsResult.value.workspace, projectIndex);
  if (!projResult.ok) return projResult;
  if (projResult.value.layout !== 'kanban') {
    return err('NOT_KANBAN_PROJECT', 'Cannot reorder columns on a checklist project');
  }

  const columns = getColumns(projResult.value);
  if (columnIndex < 0 || columnIndex >= columns.length) {
    return err('COLUMN_NOT_FOUND', `Column at index ${columnIndex} not found`);
  }
  if (newIndex < 0 || newIndex >= columns.length) {
    return err('INDEX_OUT_OF_BOUNDS', `New index ${newIndex} is out of bounds`);
  }

  const updatedProject = reorderColumnAt(projResult.value, columnIndex, newIndex);
  const newTodoFile = replaceProject(wsResult.value.workspace.todoFile, projectIndex, updatedProject);
  return ok(updateWorkspace(state, workspaceId, newTodoFile));
}
