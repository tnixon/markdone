import { InMemoryFileSystem } from '@markdone/core';
import { parseWorkspaceArgs, loadNamedWorkspaces } from '../workspaces';

describe('parseWorkspaceArgs', () => {
  test('parses repeatable --workspace <name>=<path> from argv', () => {
    const specs = parseWorkspaceArgs(['--workspace', 'personal=/vault/tasks', '--workspace', 'shared=/vault/shared'], {});
    expect(specs).toEqual([
      { id: 'personal', path: '/vault/tasks' },
      { id: 'shared', path: '/vault/shared' },
    ]);
  });

  test('falls back to MARKDONE_WORKSPACES when argv has no --workspace', () => {
    const specs = parseWorkspaceArgs([], { MARKDONE_WORKSPACES: 'personal=/vault/tasks,shared=/vault/shared' });
    expect(specs).toEqual([
      { id: 'personal', path: '/vault/tasks' },
      { id: 'shared', path: '/vault/shared' },
    ]);
  });

  test('argv takes precedence over the env fallback', () => {
    const specs = parseWorkspaceArgs(['--workspace', 'argv=/from/argv'], { MARKDONE_WORKSPACES: 'env=/from/env' });
    expect(specs).toEqual([{ id: 'argv', path: '/from/argv' }]);
  });

  test('a --workspace with no value is a usage error', () => {
    expect(() => parseWorkspaceArgs(['--workspace'], {})).toThrow('--workspace requires a value');
  });
});

describe('loadNamedWorkspaces', () => {
  test('resolves specs into a Map keyed by workspace id', async () => {
    const fs = new InMemoryFileSystem();
    const map = await loadNamedWorkspaces([{ id: 'personal', path: 'personal.md' }, { id: 'shared', path: 'shared.md' }], fs);
    expect([...map.keys()]).toEqual(['personal', 'shared']);
    expect(map.get('personal')?.id).toBe('personal');
  });

  test('with no specs, fails fast instead of silently defaulting to a workspace named after ./todo.md', async () => {
    const fs = new InMemoryFileSystem();
    await expect(loadNamedWorkspaces([], fs)).rejects.toThrow(/--workspace|MARKDONE_WORKSPACES/);
  });
});
