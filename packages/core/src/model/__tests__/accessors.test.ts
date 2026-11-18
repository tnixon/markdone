import type { Block, ChecklistProject, Frontmatter, Task, Workspace } from '../types';
import { getEffectiveOwner, isWaiting, getEnergy, getDependency, getRecurrence, setTasks } from '../accessors';

const EMPTY_FRONTMATTER: Frontmatter = { raw: '', recognized: {}, unknown: {}, present: false };

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

function makeProject(frontmatterRecognized: Record<string, unknown> = {}): ChecklistProject {
  return {
    layout: 'checklist',
    name: 'P',
    frontmatter: { ...EMPTY_FRONTMATTER, recognized: frontmatterRecognized },
    blocks: [],
  };
}

function makeWorkspace(project: ChecklistProject, workspaceFrontmatterRecognized: Record<string, unknown> = {}): Workspace {
  return {
    config: { id: 'ws1', name: 'WS', filePath: '/ws.md' },
    todoFile: {
      frontmatter: { ...EMPTY_FRONTMATTER, recognized: workspaceFrontmatterRecognized },
      preamble: [],
      projects: [project],
    },
  };
}

describe('getEffectiveOwner', () => {
  test('an explicit #owner/ tag wins over any default', () => {
    const task = makeTask({ tags: [{ type: 'nested', key: 'owner', value: 'alice' }] });
    const project = makeProject({ owner: 'bob' });
    const workspace = makeWorkspace(project, { owner: 'carol' });
    expect(getEffectiveOwner(task, project, workspace)).toBe('alice');
  });

  test('falls back to the project frontmatter owner', () => {
    const task = makeTask();
    const project = makeProject({ owner: 'bob' });
    const workspace = makeWorkspace(project, { owner: 'carol' });
    expect(getEffectiveOwner(task, project, workspace)).toBe('bob');
  });

  test('falls back to the workspace frontmatter owner (file mode)', () => {
    const task = makeTask();
    const project = makeProject();
    const workspace = makeWorkspace(project, { owner: 'carol' });
    expect(getEffectiveOwner(task, project, workspace)).toBe('carol');
  });

  test('is undefined when nothing specifies an owner', () => {
    const task = makeTask();
    const project = makeProject();
    const workspace = makeWorkspace(project);
    expect(getEffectiveOwner(task, project, workspace)).toBeUndefined();
  });
});

describe('isWaiting', () => {
  test('true when a #waiting/ tag is present', () => {
    expect(isWaiting(makeTask({ tags: [{ type: 'nested', key: 'waiting', value: 'dana' }] }))).toBe(true);
  });

  test('false otherwise', () => {
    expect(isWaiting(makeTask())).toBe(false);
    expect(isWaiting(makeTask({ tags: [{ type: 'label', name: 'urgent' }] }))).toBe(false);
  });
});

describe('getEnergy', () => {
  test('reads a valid #energy/ level', () => {
    expect(getEnergy(makeTask({ tags: [{ type: 'nested', key: 'energy', value: 'high' }] }))).toBe('high');
  });

  test('is undefined for an unrecognized level or no tag', () => {
    expect(getEnergy(makeTask({ tags: [{ type: 'nested', key: 'energy', value: 'medium' }] }))).toBeUndefined();
    expect(getEnergy(makeTask())).toBeUndefined();
  });
});

describe('getDependency', () => {
  test('reads the #after/ block id', () => {
    expect(getDependency(makeTask({ tags: [{ type: 'nested', key: 'after', value: 'abc123' }] }))).toBe('abc123');
  });

  test('is undefined with no #after/ tag', () => {
    expect(getDependency(makeTask())).toBeUndefined();
  });
});

describe('getRecurrence', () => {
  test('reads the #every/ rule', () => {
    expect(getRecurrence(makeTask({ tags: [{ type: 'nested', key: 'every', value: 'weekly' }] }))).toBe('weekly');
  });

  test('is undefined with no #every/ tag', () => {
    expect(getRecurrence(makeTask())).toBeUndefined();
  });
});

// setTasks rebuilds `project.blocks` from a new task array, reattaching each
// task's preceding opaque content (prose, headings, comments). These cases
// cover the alignment regression: a task mutated in place, moved, inserted,
// or deleted with NO `^id` must still keep its neighboring content where it
// belongs — reference identity and `blockId` are anchors, not the only way
// a task can be found.
describe('setTasks (block realignment)', () => {
  function opaque(raw: string): Block {
    return { type: 'opaque', raw };
  }
  function taskBlock(task: Task): Block {
    return { type: 'task', task };
  }
  function makeProjectWithBlocks(blocks: Block[]): ChecklistProject {
    return { layout: 'checklist', name: 'P', frontmatter: EMPTY_FRONTMATTER, blocks };
  }

  test('in-place replace of a task with no ^id keeps its preceding opaque content in place', () => {
    const a = makeTask({ id: 'a', text: 'A' });
    const b = makeTask({ id: 'b', text: 'B' });
    const project = makeProjectWithBlocks([opaque('## Section'), taskBlock(a), taskBlock(b)]);

    // An in-place mutation (updateTask/completeTask/etc.) builds a NEW
    // object at the same index — never the same reference.
    const aReplaced: Task = { ...a, completed: true, checkbox: { state: 'done', marker: 'x' } };
    const result = setTasks(project, [aReplaced, b]);

    expect(result.blocks).toEqual([opaque('## Section'), taskBlock(aReplaced), taskBlock(b)]);
  });

  test('a replaced task that already has a ^id still anchors by id despite the new object identity', () => {
    const a = makeTask({ id: 'a', blockId: 'stable-1' });
    const b = makeTask({ id: 'b' });
    const project = makeProjectWithBlocks([opaque('desc'), taskBlock(a), taskBlock(b)]);

    const aReplaced: Task = { ...a, completed: true };
    const result = setTasks(project, [aReplaced, b]);

    expect(result.blocks).toEqual([opaque('desc'), taskBlock(aReplaced), taskBlock(b)]);
  });

  test('insert appends a new task with no preceding opaque manufactured for it', () => {
    const a = makeTask({ id: 'a' });
    const project = makeProjectWithBlocks([opaque('## Section'), taskBlock(a)]);
    const c = makeTask({ id: 'c', text: 'C' });

    const result = setTasks(project, [a, c]);

    expect(result.blocks).toEqual([opaque('## Section'), taskBlock(a), taskBlock(c)]);
  });

  test('delete removes the task; its orphaned preceding opaque survives, not lost, just relocated', () => {
    const a = makeTask({ id: 'a' });
    const b = makeTask({ id: 'b' });
    const project = makeProjectWithBlocks([
      opaque('## A section'),
      taskBlock(a),
      opaque('## B section'),
      taskBlock(b),
    ]);

    const result = setTasks(project, [b]);

    expect(result.blocks).toEqual([opaque('## B section'), taskBlock(b), opaque('## A section')]);
  });

  test('reorder (identity-preserving) carries a task\'s preceding content to its new position, with no ^id needed', () => {
    const a = makeTask({ id: 'a', text: 'A' });
    const b = makeTask({ id: 'b', text: 'B' });
    const c = makeTask({ id: 'c', text: 'C' });
    const project = makeProjectWithBlocks([opaque('note above A'), taskBlock(a), taskBlock(b), taskBlock(c)]);

    // reorderTask splices the same object references into a new order.
    const result = setTasks(project, [b, c, a]);

    expect(result.blocks).toEqual([taskBlock(b), taskBlock(c), opaque('note above A'), taskBlock(a)]);
  });

  test('a moved task with a NEW object identity (moveTask\'s {...task} spread) still carries its content, with no ^id needed', () => {
    const a = makeTask({ id: 'a', text: 'A' });
    const b = makeTask({ id: 'b', text: 'B' });
    const c = makeTask({ id: 'c', text: 'C' });
    const project = makeProjectWithBlocks([opaque('note above A'), taskBlock(a), taskBlock(b), taskBlock(c)]);

    const aMoved: Task = { ...a };
    const result = setTasks(project, [b, aMoved, c]);

    expect(result.blocks).toEqual([taskBlock(b), opaque('note above A'), taskBlock(aMoved), taskBlock(c)]);
  });
});
