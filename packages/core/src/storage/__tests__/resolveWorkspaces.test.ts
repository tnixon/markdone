import { parseWorkspaceSpec, parseWorkspacesFromEnv, resolveWorkspaces, buildQueryState } from '../resolveWorkspaces';
import { InMemoryFileSystem } from '../inMemoryFileSystem';
import { WorkspaceError } from '../errors';
import { DirectoryWorkspaceHandle } from '../directoryWorkspaceHandle';
import { FileWorkspaceHandle } from '../fileWorkspaceHandle';

describe('parseWorkspaceSpec', () => {
  test('a bare path has no id', () => {
    expect(parseWorkspaceSpec('/vault/tasks')).toEqual({ path: '/vault/tasks' });
  });

  test('an id=path spec splits on the first =', () => {
    expect(parseWorkspaceSpec('personal=/vault/tasks')).toEqual({ id: 'personal', path: '/vault/tasks' });
  });
});

describe('parseWorkspacesFromEnv', () => {
  test('unset returns []', () => {
    expect(parseWorkspacesFromEnv({})).toEqual([]);
  });

  test('empty string returns []', () => {
    expect(parseWorkspacesFromEnv({ MARKDONE_WORKSPACES: '' })).toEqual([]);
  });

  test('a single entry', () => {
    expect(parseWorkspacesFromEnv({ MARKDONE_WORKSPACES: 'personal=/vault/tasks' })).toEqual([
      { id: 'personal', path: '/vault/tasks' },
    ]);
  });

  test('multiple comma-separated entries, with whitespace trimmed', () => {
    expect(parseWorkspacesFromEnv({ MARKDONE_WORKSPACES: ' personal=/vault/tasks , shared=/vault/shared ' })).toEqual([
      { id: 'personal', path: '/vault/tasks' },
      { id: 'shared', path: '/vault/shared' },
    ]);
  });
});

describe('resolveWorkspaces', () => {
  test('expands a leading ~ using HOME', async () => {
    const fs = new InMemoryFileSystem();
    await fs.write('/home/me/todo.md', '- [ ] Buy milk\n');
    const [ws] = await resolveWorkspaces([{ id: 'p', path: '~/todo.md' }], fs, { HOME: '/home/me' });
    expect(ws.path).toBe('/home/me/todo.md');
  });

  test('a leading ~ with no HOME is a WorkspaceError', async () => {
    await expect(resolveWorkspaces([{ path: '~/todo.md' }], new InMemoryFileSystem(), {})).rejects.toThrow(/HOME/);
  });

  test('a path with no .md suffix that does not exist resolves to a new directory workspace', async () => {
    const fs = new InMemoryFileSystem();
    const [resolved] = await resolveWorkspaces([{ path: 'vault' }], fs, {});
    expect(resolved.isDirectory).toBe(true);
    expect(resolved.handle).toBeInstanceOf(DirectoryWorkspaceHandle);
  });

  test('a .md path that does not exist resolves to a new file workspace', async () => {
    const fs = new InMemoryFileSystem();
    const [resolved] = await resolveWorkspaces([{ path: 'todo.md' }], fs, {});
    expect(resolved.isDirectory).toBe(false);
    expect(resolved.handle).toBeInstanceOf(FileWorkspaceHandle);
  });

  test('an existing directory is detected by stat regardless of extension', async () => {
    const fs = new InMemoryFileSystem();
    await fs.write('my.vault/inbox.md', '');
    const [resolved] = await resolveWorkspaces([{ path: 'my.vault' }], fs, {});
    expect(resolved.isDirectory).toBe(true);
  });

  test('derives an id from the path when none is given', async () => {
    const fs = new InMemoryFileSystem();
    const [resolved] = await resolveWorkspaces([{ path: 'personal.md' }], fs, {});
    expect(resolved.id).toBe('personal');
  });

  test('rejects duplicate workspace ids', async () => {
    const fs = new InMemoryFileSystem();
    await expect(
      resolveWorkspaces([{ id: 'a', path: 'one.md' }, { id: 'a', path: 'two.md' }], fs, {}),
    ).rejects.toThrow(WorkspaceError);
  });

  test('defaults to MARKDONE_WORKSPACE, then ./todo.md, when no specs are given', async () => {
    const fs = new InMemoryFileSystem();
    const [fromEnv] = await resolveWorkspaces([], fs, { MARKDONE_WORKSPACE: 'env-ws.md' });
    expect(fromEnv.path).toBe('env-ws.md');

    const [fromDefault] = await resolveWorkspaces([], fs, {});
    expect(fromDefault.path).toBe('./todo.md');
  });
});

describe('buildQueryState', () => {
  test('assembles a multi-workspace AppState with activeScope "all"', async () => {
    const fs = new InMemoryFileSystem();
    const resolved = await resolveWorkspaces(
      [{ id: 'personal', path: 'personal.md' }, { id: 'shared', path: 'shared.md' }],
      fs,
      {},
    );
    const state = buildQueryState(resolved);
    expect(state.activeScope).toBe('all');
    expect(state.workspaces.map(w => w.config.id)).toEqual(['personal', 'shared']);
  });
});
