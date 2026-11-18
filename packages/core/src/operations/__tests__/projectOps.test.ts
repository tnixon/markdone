import { describe, test, expect } from 'vitest';
import {
  addProject,
  updateProject,
  deleteProject,
  reorderProject,
  addColumn,
  renameColumn,
  deleteColumn,
  reorderColumn,
} from '../projectOps';
import { getColumns, getColumnTasks, getDescription } from '../../model/accessors';
import { makeAppState, makeChecklist, makeKanban, WORKSPACE_ID, EMPTY_FRONTMATTER } from './helpers';

function emptyState() {
  return makeAppState(WORKSPACE_ID, { frontmatter: EMPTY_FRONTMATTER, preamble: [], projects: [] });
}

function stateWith2Projects() {
  const tf: import('../../model/types').TodoFile = {
    frontmatter: EMPTY_FRONTMATTER,
    preamble: [],
    projects: [
      { name: 'Alpha', layout: 'checklist', frontmatter: EMPTY_FRONTMATTER, blocks: [] },
      { name: 'Beta', layout: 'checklist', frontmatter: EMPTY_FRONTMATTER, blocks: [] },
    ],
  };
  return makeAppState(WORKSPACE_ID, tf);
}

describe('addProject', () => {
  test('adds checklist project', () => {
    const result = addProject(emptyState(), WORKSPACE_ID, 'My List', 'checklist');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const projects = result.value.workspaces[0].todoFile.projects;
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('My List');
    expect(projects[0].layout).toBe('checklist');
  });

  test('adds kanban project with default 3 columns', () => {
    const result = addProject(emptyState(), WORKSPACE_ID, 'My Board', 'kanban');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const project = result.value.workspaces[0].todoFile.projects[0];
    expect(project.layout).toBe('kanban');
    if (project.layout === 'kanban') {
      expect(getColumns(project).map(c => c.name)).toEqual(['Todo', 'In Progress', 'Done']);
    }
  });

  test('includes optional description', () => {
    const result = addProject(emptyState(), WORKSPACE_ID, 'P', 'checklist', 'Desc text');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getDescription(result.value.workspaces[0].todoFile.projects[0])).toBe('Desc text');
  });

  test('returns error for unknown workspace', () => {
    const result = addProject(emptyState(), 'bad', 'P', 'checklist');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('WORKSPACE_NOT_FOUND');
  });

  test('does not mutate original state', () => {
    const state = emptyState();
    const original = state.workspaces[0].todoFile.projects;
    addProject(state, WORKSPACE_ID, 'P', 'checklist');
    expect(original).toHaveLength(0);
  });
});

describe('updateProject', () => {
  test('renames project', () => {
    const result = updateProject(stateWith2Projects(), WORKSPACE_ID, 0, { name: 'Renamed' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.workspaces[0].todoFile.projects[0].name).toBe('Renamed');
  });

  test('updates description only', () => {
    const result = updateProject(stateWith2Projects(), WORKSPACE_ID, 1, { description: 'New desc' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const p = result.value.workspaces[0].todoFile.projects[1];
    expect(p.name).toBe('Beta');
    expect(getDescription(p)).toBe('New desc');
  });

  test('returns error for invalid project index', () => {
    const result = updateProject(stateWith2Projects(), WORKSPACE_ID, 99, { name: 'x' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PROJECT_NOT_FOUND');
  });
});

describe('deleteProject', () => {
  test('removes project by index', () => {
    const result = deleteProject(stateWith2Projects(), WORKSPACE_ID, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const projects = result.value.workspaces[0].todoFile.projects;
    expect(projects).toHaveLength(1);
    expect(projects[0].name).toBe('Beta');
  });

  test('returns error for invalid index', () => {
    const result = deleteProject(stateWith2Projects(), WORKSPACE_ID, 5);
    expect(result.ok).toBe(false);
  });
});

describe('reorderProject', () => {
  test('moves project to new position', () => {
    const result = reorderProject(stateWith2Projects(), WORKSPACE_ID, 0, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const names = result.value.workspaces[0].todoFile.projects.map(p => p.name);
    expect(names).toEqual(['Beta', 'Alpha']);
  });

  test('returns error for out-of-bounds newIndex', () => {
    const result = reorderProject(stateWith2Projects(), WORKSPACE_ID, 0, 5);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INDEX_OUT_OF_BOUNDS');
  });
});

describe('addColumn', () => {
  test('appends column to kanban project', () => {
    const state = makeAppState(WORKSPACE_ID, makeKanban());
    const result = addColumn(state, WORKSPACE_ID, 0, 'Review');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const project = result.value.workspaces[0].todoFile.projects[0];
    expect(project.layout).toBe('kanban');
    if (project.layout === 'kanban') {
      const columns = getColumns(project);
      expect(columns).toHaveLength(4);
      expect(columns[3].name).toBe('Review');
    }
  });

  test('inserts column at specified index', () => {
    const state = makeAppState(WORKSPACE_ID, makeKanban());
    const result = addColumn(state, WORKSPACE_ID, 0, 'Review', 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const project = result.value.workspaces[0].todoFile.projects[0];
    if (project.layout === 'kanban') {
      expect(getColumns(project)[1].name).toBe('Review');
    }
  });

  test('clamps atIndex beyond bounds to end of column list', () => {
    const state = makeAppState(WORKSPACE_ID, makeKanban()); // 3 columns
    const result = addColumn(state, WORKSPACE_ID, 0, 'Review', 999);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const project = result.value.workspaces[0].todoFile.projects[0];
    if (project.layout === 'kanban') {
      const columns = getColumns(project);
      expect(columns).toHaveLength(4);
      expect(columns[3].name).toBe('Review');
    }
  });

  test('returns error when adding column to checklist project', () => {
    const state = makeAppState(WORKSPACE_ID, makeChecklist());
    const result = addColumn(state, WORKSPACE_ID, 0, 'NewCol');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_KANBAN_PROJECT');
  });
});

describe('renameColumn', () => {
  test('renames existing column', () => {
    const state = makeAppState(WORKSPACE_ID, makeKanban());
    const result = renameColumn(state, WORKSPACE_ID, 0, 0, 'Backlog');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const project = result.value.workspaces[0].todoFile.projects[0];
    if (project.layout === 'kanban') {
      const columns = getColumns(project);
      expect(columns[0].name).toBe('Backlog');
      expect(columns[1].name).toBe('In Progress');
    }
  });

  test('returns error for invalid column index', () => {
    const state = makeAppState(WORKSPACE_ID, makeKanban());
    const result = renameColumn(state, WORKSPACE_ID, 0, 9, 'Bad');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('COLUMN_NOT_FOUND');
  });

  test('returns error for checklist project', () => {
    const state = makeAppState(WORKSPACE_ID, makeChecklist());
    const result = renameColumn(state, WORKSPACE_ID, 0, 0, 'Col');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_KANBAN_PROJECT');
  });
});

describe('deleteColumn', () => {
  test('deletes column and its tasks', () => {
    const state = makeAppState(
      WORKSPACE_ID,
      makeKanban([
        { name: 'Todo', tasks: [{ text: 'Task A' }] },
        { name: 'In Progress' },
        { name: 'Done' },
      ]),
    );
    const result = deleteColumn(state, WORKSPACE_ID, 0, 0, 'delete');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const project = result.value.workspaces[0].todoFile.projects[0];
    if (project.layout === 'kanban') {
      const columns = getColumns(project);
      expect(columns).toHaveLength(2);
      expect(columns[0].name).toBe('In Progress');
    }
  });

  test('moves tasks to target column before deleting', () => {
    const state = makeAppState(
      WORKSPACE_ID,
      makeKanban([
        { name: 'Todo', tasks: [{ text: 'Task A' }, { text: 'Task B' }] },
        { name: 'In Progress' },
        { name: 'Done' },
      ]),
    );
    const result = deleteColumn(state, WORKSPACE_ID, 0, 0, { targetColumnIndex: 1 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const project = result.value.workspaces[0].todoFile.projects[0];
    if (project.layout === 'kanban') {
      const columns = getColumns(project);
      expect(columns).toHaveLength(2);
      // Column 1 (originally "In Progress") is now column 0 and has the tasks
      expect(getColumnTasks(columns[0])).toHaveLength(2);
    }
  });

  test('moves tasks to target column when target is after deleted column (adjusts effectiveTarget)', () => {
    const state = makeAppState(
      WORKSPACE_ID,
      makeKanban([
        { name: 'Todo', tasks: [{ text: 'Task A' }] },
        { name: 'In Progress' },
        { name: 'Done' },
      ]),
    );
    // Delete column 0 (Todo) and move its tasks to column 2 (Done, index 2 before deletion)
    const result = deleteColumn(state, WORKSPACE_ID, 0, 0, { targetColumnIndex: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const project = result.value.workspaces[0].todoFile.projects[0];
    if (project.layout === 'kanban') {
      const columns = getColumns(project);
      expect(columns).toHaveLength(2);
      // After deleting col 0, effectiveTarget = 2 - 1 = 1 (the Done column)
      expect(columns[1].name).toBe('Done');
      const tasks = getColumnTasks(columns[1]);
      expect(tasks).toHaveLength(1);
      expect(tasks[0].text).toBe('Task A');
    }
  });

  test('returns error when deleting last column', () => {
    const state = makeAppState(
      WORKSPACE_ID,
      makeKanban([{ name: 'Only Column' }]),
    );
    const result = deleteColumn(state, WORKSPACE_ID, 0, 0, 'delete');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_COLUMN_OPERATION');
  });

  test('returns error for checklist project', () => {
    const state = makeAppState(WORKSPACE_ID, makeChecklist());
    const result = deleteColumn(state, WORKSPACE_ID, 0, 0, 'delete');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_KANBAN_PROJECT');
  });
});

describe('reorderColumn', () => {
  test('moves column to new position', () => {
    const state = makeAppState(WORKSPACE_ID, makeKanban());
    const result = reorderColumn(state, WORKSPACE_ID, 0, 0, 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const project = result.value.workspaces[0].todoFile.projects[0];
    if (project.layout === 'kanban') {
      expect(getColumns(project).map(c => c.name)).toEqual(['In Progress', 'Done', 'Todo']);
    }
  });

  test('returns error for invalid column index', () => {
    const state = makeAppState(WORKSPACE_ID, makeKanban());
    const result = reorderColumn(state, WORKSPACE_ID, 0, 9, 0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('COLUMN_NOT_FOUND');
  });
});
