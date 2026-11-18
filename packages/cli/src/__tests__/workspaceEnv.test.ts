import { InMemoryFileSystem } from '@markdone/core';
import { runCli, seedFileModeFixture } from './helpers';

describe('MARKDONE_WORKSPACES env fallback', () => {
  test('with no --workspace flag, falls back to MARKDONE_WORKSPACES', async () => {
    const fs = new InMemoryFileSystem();
    await seedFileModeFixture(fs, 'file-mode', 'todo.md');
    const { code, stdout } = await runCli(fs, ['--json', 'summary', '--as-of', '2026-04-03'], {
      env: { MARKDONE_WORKSPACES: 'todo=todo.md' },
    });
    expect(code).toBe(0);
    // Same fact summary.test.ts asserts from --workspace directly: "Buy
    // groceries" is due 2026-04-01, so as-of 04-03 counts it overdue. A
    // nonzero, fixture-specific count proves the real seeded workspace was
    // actually loaded via the env var, not just that something ran.
    expect(JSON.parse(stdout.join('\n')).overdueCount).toBe(1);
  });

  test('warns on stderr when MARKDONE_WORKSPACE is shadowed by MARKDONE_WORKSPACES', async () => {
    const fs = new InMemoryFileSystem();
    await seedFileModeFixture(fs, 'file-mode', 'todo.md');
    const { code, stderr } = await runCli(fs, ['--json', 'summary', '--as-of', '2026-04-03'], {
      env: { MARKDONE_WORKSPACES: 'todo=todo.md', MARKDONE_WORKSPACE: 'other.md' },
    });
    expect(code).toBe(0);
    expect(stderr.join('\n')).toMatch(/MARKDONE_WORKSPACE is ignored/);
  });

  test('a --workspace flag wins outright over MARKDONE_WORKSPACES, no merging', async () => {
    const fs = new InMemoryFileSystem();
    await seedFileModeFixture(fs, 'file-mode', 'todo.md');
    // Deliberately not seeded: if the env var were used instead of (or
    // merged with) the flag, resolveWorkspaces would treat this path as a
    // brand-new empty workspace, and overdueCount would be 0 instead of 1.
    const { code, stdout } = await runCli(fs, ['--workspace', 'todo.md', '--json', 'summary', '--as-of', '2026-04-03'], {
      env: { MARKDONE_WORKSPACES: 'other=unseeded.md' },
    });
    expect(code).toBe(0);
    expect(JSON.parse(stdout.join('\n')).overdueCount).toBe(1);
  });
});
