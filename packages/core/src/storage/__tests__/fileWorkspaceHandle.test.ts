import { FileWorkspaceHandle } from '../fileWorkspaceHandle';
import { InMemoryFileSystem } from '../inMemoryFileSystem';
import { ExternalChangeError } from '../errors';
import { operationRegistry } from '../../operations/registry';
import type { OperationDefinition } from '../../operations/types';

function opNamed(name: string): OperationDefinition {
  const op = operationRegistry.find(o => o.name === name);
  if (!op) throw new Error(`No such operation: ${name}`);
  return op;
}

describe('FileWorkspaceHandle', () => {
  let fs: InMemoryFileSystem;

  beforeEach(() => {
    fs = new InMemoryFileSystem();
  });

  test('reload on a missing file yields an empty Inbox', async () => {
    const handle = new FileWorkspaceHandle('ws-1', 'todo.md', fs);
    await handle.reload();
    expect(handle.listProjects()).toEqual([
      expect.objectContaining({ name: 'Inbox', layout: 'checklist' }),
    ]);
  });

  test('reload parses existing file content', async () => {
    await fs.write('todo.md', '# Inbox\n\n- [ ] Buy milk\n\n# Website\n\n- [ ] Design homepage\n');
    const handle = new FileWorkspaceHandle('ws-1', 'todo.md', fs);
    await handle.reload();

    expect(handle.listProjects().map(p => p.name)).toEqual(['Inbox', 'Website']);
    expect(handle.getProject('Website')).toBeDefined();
    expect(handle.getProject('Nonexistent')).toBeUndefined();
  });

  test('getProject/listProjects throw before reload', () => {
    const handle = new FileWorkspaceHandle('ws-1', 'todo.md', fs);
    expect(() => handle.listProjects()).toThrow(/not loaded/);
  });

  test('applyOperation mutates and persists to the file system', async () => {
    const handle = new FileWorkspaceHandle('ws-1', 'todo.md', fs);
    await handle.reload();

    const result = await handle.applyOperation(opNamed('addTask'), {
      workspaceId: 'ws-1',
      projectIndex: 0,
      columnIndex: undefined,
      task: { text: 'Buy milk' },
    });

    expect(result.ok).toBe(true);
    expect(handle.getProject('Inbox')?.layout).toBe('checklist');

    const written = await fs.read('todo.md');
    expect(written).toContain('Buy milk');

    // A fresh handle reading the same file sees the persisted task.
    const reloaded = new FileWorkspaceHandle('ws-1', 'todo.md', fs);
    await reloaded.reload();
    const inbox = reloaded.getProject('Inbox');
    expect(inbox?.layout).toBe('checklist');
    if (inbox?.layout === 'checklist') {
      expect(inbox.blocks).toEqual([{ type: 'task', task: expect.objectContaining({ text: 'Buy milk' }) }]);
    }
  });

  test('applyOperation returns an error and does not write on validation failure', async () => {
    const handle = new FileWorkspaceHandle('ws-1', 'todo.md', fs);
    await handle.reload();

    const result = await handle.applyOperation(opNamed('deleteTask'), {
      location: { workspaceId: 'ws-1', projectIndex: 0, taskIndex: 0 },
    });

    expect(result.ok).toBe(false);
    await expect(fs.stat('todo.md')).rejects.toThrow();
  });

  test('applyOperation surfaces an error from the operation and does not write', async () => {
    const handle = new FileWorkspaceHandle('ws-1', 'todo.md', fs);
    await handle.reload();

    const result = await handle.applyOperation(
      {
        name: 'alwaysFails',
        description: '',
        parameters: {},
        returns: {},
        category: 'task',
        mutating: true,
        execute: () => ({ ok: false, error: { code: 'BOOM', message: 'nope' } }),
        describe: () => '',
      },
      {},
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('BOOM');
    await expect(fs.stat('todo.md')).rejects.toThrow();
  });

  test('applyOperation dispatches applyBatch, which is not in the task/project-only operationHandlers map', async () => {
    const handle = new FileWorkspaceHandle('ws-1', 'todo.md', fs);
    await handle.reload();

    const result = await handle.applyOperation(opNamed('applyBatch'), {
      operations: [
        { op: 'addTask', params: { workspaceId: 'ws-1', projectIndex: 0, task: { text: 'First' } } },
        { op: 'addTask', params: { workspaceId: 'ws-1', projectIndex: 0, task: { text: 'Second' } } },
      ],
    });

    expect(result.ok).toBe(true);
    const written = await fs.read('todo.md');
    expect(written).toContain('First');
    expect(written).toContain('Second');
  });

  test('applyOperation throws ExternalChangeError when the file changed since load', async () => {
    await fs.write('todo.md', '# Inbox\n\n- [ ] Original\n');
    const handle = new FileWorkspaceHandle('ws-1', 'todo.md', fs);
    await handle.reload();

    // Simulate an external edit after load.
    await fs.write('todo.md', '# Inbox\n\n- [ ] Someone else edited this\n');

    await expect(
      handle.applyOperation(opNamed('addTask'), {
        workspaceId: 'ws-1',
        projectIndex: 0,
        task: { text: 'Buy milk' },
      }),
    ).rejects.toThrow(ExternalChangeError);
  });

  test('applyOperation throws ExternalChangeError when the file was created externally after a load that found nothing', async () => {
    // No file at load — lastMtimeMs is undefined, matching a brand-new
    // workspace. That must mean "assert the file still doesn't exist", not
    // "skip the check": someone else may have created it since.
    const handle = new FileWorkspaceHandle('ws-1', 'todo.md', fs);
    await handle.reload();

    await fs.write('todo.md', '# Inbox\n\n- [ ] Created by someone else\n');

    await expect(
      handle.applyOperation(opNamed('addTask'), {
        workspaceId: 'ws-1',
        projectIndex: 0,
        task: { text: 'Buy milk' },
      }),
    ).rejects.toThrow(ExternalChangeError);
    expect(await fs.read('todo.md')).toBe('# Inbox\n\n- [ ] Created by someone else\n');
  });
});
