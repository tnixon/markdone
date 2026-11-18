import { InMemoryFileSystem } from '@markdone/core';
import { runCli, seedFileModeFixture } from './helpers';

describe('--help / --version', () => {
  test('markdone --help prints usage to stdout and exits 0, with no workspace needed', async () => {
    const fs = new InMemoryFileSystem();
    const { code, stdout, stderr } = await runCli(fs, ['--help']);
    expect(code).toBe(0);
    expect(stderr).toEqual([]);
    expect(stdout.join('\n')).toContain('markdone');
    expect(stdout.join('\n')).toContain('Query commands:');
  });

  test('markdone <query-command> --help prints that command\'s usage and exits 0', async () => {
    const fs = new InMemoryFileSystem();
    const { code, stdout } = await runCli(fs, ['list', '--help']);
    expect(code).toBe(0);
    expect(stdout.join('\n')).toContain('markdone list');
    expect(stdout.join('\n')).toContain('--context');
  });

  test('markdone <mutation-command> --help prints that command\'s usage and exits 0, without requiring its normally-required flags', async () => {
    const fs = new InMemoryFileSystem();
    const { code, stdout } = await runCli(fs, ['add', '--help']);
    expect(code).toBe(0);
    expect(stdout.join('\n')).toContain('markdone add');
    expect(stdout.join('\n')).toContain('--project');
  });

  test('markdone --version prints a version and exits 0', async () => {
    const fs = new InMemoryFileSystem();
    const { code, stdout } = await runCli(fs, ['--version']);
    expect(code).toBe(0);
    // Real installs get a real semver, baked in at build time (see
    // packages/toolkit/build.mjs). Run unbundled, as here, there's no build
    // step to inject it, so run.ts's own fallback applies instead.
    expect(stdout.join('\n')).toMatch(/^(\d+\.\d+\.\d+|0\.0\.0-dev)$/);
  });

  test('a real invocation is unaffected by --help/--version handling', async () => {
    const fs = new InMemoryFileSystem();
    await seedFileModeFixture(fs, 'file-mode', 'todo.md');
    const { code } = await runCli(fs, ['--workspace', 'todo.md', 'waiting']);
    expect(code).toBe(0);
  });
});
