import { App } from '../__tests__/fakeObsidian';
import { WorkspaceManager } from '../workspaces';
import { lintAllWorkspaces } from './lintWorkspace';

describe('lintAllWorkspaces', () => {
  test('reports the same findings markdone lint would, across every configured workspace', async () => {
    const app = new App({
      'workspace/inbox.md': '---\nmarkdone: 2\n---\n- [ ] Unsorted thought ^has-id',
      'workspace/reading-list.md': ['---', 'markdone: 2', '---', '# Reading List', '', '- [ ] Deep Work'].join('\n'),
    });
    const manager = new WorkspaceManager(app as any, () => {});
    await manager.configure(['workspace']);

    const findings = await lintAllWorkspaces(app as any, manager);

    // reconcileBlockIds (run during configure/reload) already assigned an
    // id to "Deep Work", so lint should have nothing left to flag.
    expect(findings).toEqual([]);
  });

  test('flags a duplicate ^id across files in the same workspace', async () => {
    const app = new App({
      'workspace/inbox.md': '- [ ] First ^dup',
      'workspace/reading-list.md': ['---', 'markdone: 2', '---', '# Reading List', '', '- [ ] Second ^dup'].join('\n'),
    });
    const manager = new WorkspaceManager(app as any, () => {});
    await manager.configure(['workspace']);

    const findings = await lintAllWorkspaces(app as any, manager);

    expect(findings).toContainEqual(expect.objectContaining({ severity: 'error', message: expect.stringContaining('Duplicate ^dup') }));
  });
});
