// End-to-end proof that VaultFileSystem satisfies core's FileSystem contract
// well enough for a real WorkspaceHandle to run on it — not just the
// individual method checks in vaultFileSystem.test.ts.
import { App } from './fakeObsidian';
import { DirectoryWorkspaceHandle, getOperation } from '@markdone/core';
import { VaultFileSystem } from '../vaultFileSystem';

describe('DirectoryWorkspaceHandle over VaultFileSystem', () => {
  test('reload lists projects and creates a missing inbox.md', async () => {
    const app = new App({
      'workspace/reading-list.md': ['---', 'markdone: 2', '---', '# Reading List', '', '- [ ] Deep Work ~6hrs'].join('\n'),
    });
    const handle = new DirectoryWorkspaceHandle('ws', 'workspace', new VaultFileSystem(app as any));

    await handle.reload();

    const names = handle.listProjects().map(p => p.name);
    expect(names).toContain('Inbox');
    expect(names).toContain('Reading List');
    expect(app.vault.has('workspace/inbox.md')).toBe(true);
  });

  test('a preview computes a diff without writing, and applying it writes exactly one file', async () => {
    const app = new App({
      'workspace/reading-list.md': ['---', 'markdone: 2', '---', '# Reading List', '', '- [ ] Deep Work ~6hrs'].join('\n'),
    });
    const handle = new DirectoryWorkspaceHandle('ws', 'workspace', new VaultFileSystem(app as any));
    await handle.reload();

    const completeTask = getOperation('completeTask')!;
    const input = { location: { workspaceId: 'ws', projectIndex: 1, taskIndex: 0 } };

    const before = app.vault.fileContent('workspace/reading-list.md');
    const preview = await handle.previewOperation(completeTask, input);
    expect(preview.ok).toBe(true);
    // Preview computes the change but writes nothing.
    expect(app.vault.fileContent('workspace/reading-list.md')).toBe(before);

    const applied = await handle.applyOperation(completeTask, input);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(applied.value.changes).toHaveLength(1);
    expect(app.vault.fileContent('workspace/reading-list.md')).toContain('- [x] Deep Work');
  });
});
