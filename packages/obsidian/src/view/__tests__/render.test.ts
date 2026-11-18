// @vitest-environment jsdom
import type { AppState, Task, TaskWithLocation, Workspace } from '@markdone/core';
import { groupTasks, projectsStalledOnNext, renderTaskList } from '../render';

const EMPTY_FRONTMATTER = { raw: '', recognized: {}, unknown: {}, present: false };

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 't1',
    text: 'Task',
    checkbox: { state: 'open', marker: ' ' },
    completed: false,
    contexts: [],
    tags: [],
    subtasks: [],
    ...overrides,
  };
}

function makeState(): AppState {
  const projectA = {
    layout: 'checklist' as const,
    name: 'Project A',
    frontmatter: { ...EMPTY_FRONTMATTER, recognized: { owner: 'alice' } },
    blocks: [],
  };
  const workspace: Workspace = {
    config: { id: 'ws1', name: 'WS', filePath: '/ws' },
    todoFile: { frontmatter: EMPTY_FRONTMATTER, preamble: [], projects: [projectA] },
  };
  return { activeScope: 'ws1', workspaces: [workspace] };
}

function item(task: Task, projectIndex = 0): TaskWithLocation {
  return { task, location: { workspaceId: 'ws1', projectIndex, taskIndex: 0 }, project: { name: 'Project A' } };
}

describe('groupTasks', () => {
  test('groups by project name', () => {
    const state = makeState();
    const groups = groupTasks(state, [item(makeTask({ text: 'A' }))], 'project');
    expect(groups).toEqual([{ label: 'Project A', rows: [expect.objectContaining({ workspaceId: 'ws1' })] }]);
  });

  test('a task with no context groups under "(no context)"', () => {
    const state = makeState();
    const groups = groupTasks(state, [item(makeTask())], 'context');
    expect(groups.map(g => g.label)).toEqual(['(no context)']);
  });

  test('a task with multiple contexts appears in each of its context groups', () => {
    const state = makeState();
    const task = makeTask({ contexts: ['home', 'phone'] });
    const groups = groupTasks(state, [item(task)], 'context');
    expect(groups.map(g => g.label).sort()).toEqual(['home', 'phone']);
  });

  test('owner grouping falls back through project frontmatter when the task has no #owner/ tag', () => {
    const state = makeState();
    const groups = groupTasks(state, [item(makeTask())], 'owner');
    expect(groups.map(g => g.label)).toEqual(['alice']);
  });

  test('groups are sorted alphabetically by label', () => {
    const state = makeState();
    const groups = groupTasks(
      state,
      [item(makeTask({ contexts: ['zephyr'] })), item(makeTask({ contexts: ['alpha'] }))],
      'context',
    );
    expect(groups.map(g => g.label)).toEqual(['alpha', 'zephyr']);
  });
});

describe('projectsStalledOnNext', () => {
  test('flags a kanban project whose Next column has no open task', () => {
    const workspace: Workspace = {
      config: { id: 'ws1', name: 'WS', filePath: '/ws' },
      todoFile: {
        frontmatter: EMPTY_FRONTMATTER,
        preamble: [],
        projects: [
          {
            layout: 'kanban',
            name: 'Stalled Project',
            frontmatter: EMPTY_FRONTMATTER,
            preamble: [],
            sections: [{ kind: 'column', name: 'Next', blocks: [] }],
          },
        ],
      },
    };
    expect(projectsStalledOnNext({ activeScope: 'ws1', workspaces: [workspace] })).toEqual(['Stalled Project']);
  });

  test('does not flag a Next column with an open task', () => {
    const workspace: Workspace = {
      config: { id: 'ws1', name: 'WS', filePath: '/ws' },
      todoFile: {
        frontmatter: EMPTY_FRONTMATTER,
        preamble: [],
        projects: [
          {
            layout: 'kanban',
            name: 'Healthy Project',
            frontmatter: EMPTY_FRONTMATTER,
            preamble: [],
            sections: [{ kind: 'column', name: 'Next', blocks: [{ type: 'task', task: makeTask() }] }],
          },
        ],
      },
    };
    expect(projectsStalledOnNext({ activeScope: 'ws1', workspaces: [workspace] })).toEqual([]);
  });

  test('does not flag a checklist project at all', () => {
    expect(projectsStalledOnNext(makeState())).toEqual([]);
  });
});

describe('renderTaskList', () => {
  test('renders an empty state with no groups', () => {
    const container = document.createElement('div');
    renderTaskList(container, [], { onToggle: () => {}, onOpenTask: () => {} });
    expect(container.querySelector('.markdone-empty')?.textContent).toBe('No open tasks.');
  });

  test('renders a group heading with its count and one row per task', () => {
    const container = document.createElement('div');
    const groups = groupTasks(makeState(), [item(makeTask({ text: 'Buy milk' }))], 'project');
    renderTaskList(container, groups, { onToggle: () => {}, onOpenTask: () => {} });

    expect(container.querySelector('h4')?.textContent).toBe('Project A (1)');
    expect(container.querySelector('.markdone-task-text')?.textContent).toBe('Buy milk');
  });

  test('clicking the checkbox calls onToggle, not the native checkbox behavior', () => {
    const container = document.createElement('div');
    const groups = groupTasks(makeState(), [item(makeTask())], 'project');
    const onToggle = vi.fn();
    renderTaskList(container, groups, { onToggle, onOpenTask: () => {} });

    const checkbox = container.querySelector<HTMLInputElement>('.markdone-task-checkbox')!;
    checkbox.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  test('clicking the task text calls onOpenTask', () => {
    const container = document.createElement('div');
    const groups = groupTasks(makeState(), [item(makeTask())], 'project');
    const onOpenTask = vi.fn();
    renderTaskList(container, groups, { onToggle: () => {}, onOpenTask });

    container.querySelector<HTMLElement>('.markdone-task-text')!.click();

    expect(onOpenTask).toHaveBeenCalledTimes(1);
  });

  test('shows a due-date badge only when the task has one', () => {
    const container = document.createElement('div');
    const groups = groupTasks(makeState(), [item(makeTask({ dueDate: '2026-04-05' }))], 'project');
    renderTaskList(container, groups, { onToggle: () => {}, onOpenTask: () => {} });
    expect(container.querySelector('.markdone-task-due')?.textContent).toBe('!2026-04-05');
  });

  test('re-rendering replaces prior content rather than appending', () => {
    const container = document.createElement('div');
    const groups = groupTasks(makeState(), [item(makeTask())], 'project');
    renderTaskList(container, groups, { onToggle: () => {}, onOpenTask: () => {} });
    renderTaskList(container, groups, { onToggle: () => {}, onOpenTask: () => {} });
    expect(container.querySelectorAll('.markdone-task-row')).toHaveLength(1);
  });
});
