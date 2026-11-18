import { App } from './fakeObsidian';
import { DirectoryWorkspaceHandle } from '@markdone/core';
import { VaultFileSystem } from '../vaultFileSystem';
import { reconcileBlockIds } from '../blockIds';

describe('reconcileBlockIds', () => {
  test('assigns ids to every task lacking one, without moving anything else', async () => {
    const app = new App({
      'workspace/reading-list.md': [
        '---',
        'markdone: 2',
        'status: someday',
        '---',
        '',
        '# Reading List',
        '',
        '## Queue',
        '',
        '- [ ] Deep Work ~6hrs',
        '- [ ] The Pragmatic Programmer ~8hrs',
      ].join('\n'),
    });
    const handle = new DirectoryWorkspaceHandle('ws', 'workspace', new VaultFileSystem(app as any));
    await handle.reload();

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await reconcileBlockIds(app as any, handle, 'workspace');
    logSpy.mockRestore();

    const content = app.vault.fileContent('workspace/reading-list.md')!;
    const lines = content.split('\n');
    expect(lines).toHaveLength(11); // no lines added or removed
    expect(lines[5]).toBe('# Reading List'); // heading unmoved
    expect(lines[9]).toMatch(/^- \[ \] Deep Work ~6hrs \^\S+$/);
    expect(lines[10]).toMatch(/^- \[ \] The Pragmatic Programmer ~8hrs \^\S+$/);
  });

  test('is a no-op when every task already has an id', async () => {
    const app = new App({
      'workspace/inbox.md': '- [ ] Already tagged ^abc123',
    });
    const handle = new DirectoryWorkspaceHandle('ws', 'workspace', new VaultFileSystem(app as any));
    await handle.reload();
    const before = app.vault.fileContent('workspace/inbox.md');

    await reconcileBlockIds(app as any, handle, 'workspace');

    expect(app.vault.fileContent('workspace/inbox.md')).toBe(before);
  });

  test('after reconciling, the handle reflects the newly-assigned ids on reload', async () => {
    const app = new App({ 'workspace/inbox.md': '- [ ] No id yet' });
    const handle = new DirectoryWorkspaceHandle('ws', 'workspace', new VaultFileSystem(app as any));
    await handle.reload();

    await reconcileBlockIds(app as any, handle, 'workspace');
    await handle.reload();

    const inbox = handle.getProject('inbox') as any;
    const task = inbox.blocks.find((b: any) => b.type === 'task').task;
    expect(task.blockId).toBeDefined();
  });
});
