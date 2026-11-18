import { InMemoryFileSystem } from '@markdone/core';
import { runCli, seedFileModeFixture, seedDirectoryModeFixture } from './helpers';

describe('lint', () => {
  test('malformed.md surfaces warnings for every malformed token and exits 3', async () => {
    const fs = new InMemoryFileSystem();
    await seedFileModeFixture(fs, 'malformed', 'todo.md');

    const { code, stdout } = await runCli(fs, ['--workspace', 'todo.md', 'lint']);
    expect(code).toBe(3);
    const out = stdout.join('\n');
    expect(out).toContain('[warn]');
  });

  test('deprecated-v1.md warnings are informational by default (exit 0) but block under --strict (exit 3)', async () => {
    const fs = new InMemoryFileSystem();
    await seedFileModeFixture(fs, 'deprecated-v1', 'todo.md');

    const plain = await runCli(fs, ['--workspace', 'todo.md', '--json', 'lint']);
    expect(plain.code).toBe(0);
    const findings = JSON.parse(plain.stdout.join('\n'));
    expect(findings.length).toBeGreaterThanOrEqual(3);
    expect(findings.every((f: { severity: string }) => f.severity === 'info')).toBe(true);

    const strict = await runCli(fs, ['--workspace', 'todo.md', 'lint', '--strict']);
    expect(strict.code).toBe(3);
  });

  test('a clean fixture has no blocking findings', async () => {
    const fs = new InMemoryFileSystem();
    await seedFileModeFixture(fs, 'wikilinks', 'todo.md');

    const { code } = await runCli(fs, ['--workspace', 'todo.md', 'lint']);
    expect(code).toBe(0);
  });

  test('detects a duplicate ^id across tasks in the same workspace', async () => {
    const fs = new InMemoryFileSystem();
    await fs.write(
      'todo.md',
      ['# Inbox', '', '- [ ] First task ^dup', '- [ ] Second task ^dup'].join('\n'),
    );

    const { code, stdout } = await runCli(fs, ['--workspace', 'todo.md', 'lint']);
    expect(code).toBe(3);
    expect(stdout.join('\n')).toContain('Duplicate ^dup');
  });

  test('detects an #after/ reference to an unknown id', async () => {
    const fs = new InMemoryFileSystem();
    await fs.write(
      'todo.md',
      ['# Inbox', '', '- [ ] Blocked task #after/ghost'].join('\n'),
    );

    const { code, stdout } = await runCli(fs, ['--workspace', 'todo.md', 'lint']);
    expect(code).toBe(3);
    expect(stdout.join('\n')).toContain('unknown ^ghost');
  });

  test('flags an invalid recognized key in _markdone.md for a directory-mode workspace', async () => {
    const fs = new InMemoryFileSystem();
    await seedDirectoryModeFixture(fs, 'workspace');
    await fs.write(
      'workspace/_markdone.md',
      ['---', 'owner: alice', 'layout: not-a-real-layout', 'priority: 1', '---', ''].join('\n'),
    );

    const { code, stdout } = await runCli(fs, ['--workspace', 'workspace', 'lint']);
    expect(code).toBe(3);
    expect(stdout.join('\n')).toContain("Invalid value for 'layout:'");
  });

  test('flags an unrecognized key in _markdone.md at info severity, promoted to warn under --strict', async () => {
    const fs = new InMemoryFileSystem();
    await seedDirectoryModeFixture(fs, 'workspace');
    await fs.write(
      'workspace/_markdone.md',
      ['---', 'owner: alice', 'sprintLength: 2w', '---', ''].join('\n'),
    );

    const plain = await runCli(fs, ['--workspace', 'workspace', 'lint']);
    expect(plain.code).toBe(0); // info-only, not blocking by default
    expect(plain.stdout.join('\n')).toContain("[info]");
    expect(plain.stdout.join('\n')).toContain('sprintLength');

    const strict = await runCli(fs, ['--workspace', 'workspace', 'lint', '--strict']);
    expect(strict.code).toBe(3);
    expect(strict.stdout.join('\n')).toContain('[warn]');
  });
});
