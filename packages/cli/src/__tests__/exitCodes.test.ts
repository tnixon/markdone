import { InMemoryFileSystem } from '@markdone/core';
import { runCli, seedFileModeFixture } from './helpers';

describe('exit codes', () => {
  test('0: a successful query', async () => {
    const fs = new InMemoryFileSystem();
    await seedFileModeFixture(fs, 'file-mode', 'todo.md');
    const { code } = await runCli(fs, ['--workspace', 'todo.md', 'waiting']);
    expect(code).toBe(0);
  });

  test('1: an unknown command', async () => {
    const fs = new InMemoryFileSystem();
    await seedFileModeFixture(fs, 'file-mode', 'todo.md');
    const { code, stderr } = await runCli(fs, ['--workspace', 'todo.md', 'bogus-command']);
    expect(code).toBe(1);
    expect(stderr.join('\n')).toContain("Unknown command 'bogus-command'");
  });

  test('1: a mutation missing a required flag', async () => {
    const fs = new InMemoryFileSystem();
    await seedFileModeFixture(fs, 'file-mode', 'todo.md');
    const { code, stderr } = await runCli(fs, ['--workspace', 'todo.md', 'rm']);
    expect(code).toBe(1);
    expect(stderr.join('\n')).toContain('--task');
  });

  test('1: multiple --workspace given to a mutation without --in to disambiguate', async () => {
    const fs = new InMemoryFileSystem();
    await seedFileModeFixture(fs, 'file-mode', 'a.md');
    await seedFileModeFixture(fs, 'file-mode', 'b.md');
    const { code, stderr } = await runCli(fs, ['--workspace', 'a.md', '--workspace', 'b.md', 'rm', '--task', 'x']);
    expect(code).toBe(1);
    expect(stderr.join('\n')).toContain('--in');
  });

  test('1: --in referencing a workspace id that was not loaded (a mutation always resolves --in)', async () => {
    const fs = new InMemoryFileSystem();
    await seedFileModeFixture(fs, 'file-mode', 'todo.md');
    const { code, stderr } = await runCli(fs, ['--workspace', 'todo.md', '--in', 'nope', 'rm', '--task', 'x']);
    expect(code).toBe(1);
    expect(stderr.join('\n')).toContain('nope');
  });

  // A missing --workspace path is not itself an error: both handles degrade
  // it to a new, empty workspace (per @markdone/core's documented graceful
  // degradation), so there's no way to provoke a load failure through
  // InMemoryFileSystem's forgiving semantics. Exit 2 is exercised instead
  // via an operation Result failure — see "TASK_NOT_FOUND" in
  // query.test.ts and mutate.test.ts.

  test('3: lint findings present', async () => {
    const fs = new InMemoryFileSystem();
    await seedFileModeFixture(fs, 'malformed', 'todo.md');
    const { code } = await runCli(fs, ['--workspace', 'todo.md', 'lint']);
    expect(code).toBe(3);
  });
});
