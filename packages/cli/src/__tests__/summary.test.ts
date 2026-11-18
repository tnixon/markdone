import { InMemoryFileSystem } from '@markdone/core';
import { runCli, seedFileModeFixture } from './helpers';

describe('summary', () => {
  let fs: InMemoryFileSystem;

  beforeEach(async () => {
    fs = new InMemoryFileSystem();
    await seedFileModeFixture(fs, 'file-mode', 'todo.md');
  });

  test('reports open counts by project, overdue, due-this-week, and Next coverage', async () => {
    // "Buy groceries" is due 2026-04-01; "Wireframe new landing page" is due
    // 2026-04-05 — as-of 04-03 puts only the first one in the past.
    const { code, stdout } = await runCli(fs, ['--workspace', 'todo.md', '--json', 'summary', '--as-of', '2026-04-03']);
    expect(code).toBe(0);
    const summary = JSON.parse(stdout.join('\n'));

    expect(summary.asOfDate).toBe('2026-04-03');
    expect(summary.overdueCount).toBe(1); // "Buy groceries", due 2026-04-01
    expect(summary.dueThisWeekCount).toBeGreaterThanOrEqual(1);
    expect(summary.projects.map((p: { name: string }) => p.name)).toEqual(
      expect.arrayContaining(['Inbox', 'Errands', 'Website Redesign']),
    );
  });

  test('human-readable output is non-empty and mentions the reference date', async () => {
    const { code, stdout } = await runCli(fs, ['--workspace', 'todo.md', 'summary', '--as-of', '2026-04-03']);
    expect(code).toBe(0);
    expect(stdout.join('\n')).toContain('2026-04-03');
  });

  test('flags a kanban project that has no Next column at all, not just an empty one', async () => {
    await fs.write(
      'todo.md',
      ['# Inbox', '', '# Sprint Board', '', '## Backlog', '', '- [ ] Plan the sprint'].join('\n'),
    );

    const { code, stdout } = await runCli(fs, ['--workspace', 'todo.md', '--json', 'summary']);
    expect(code).toBe(0);
    const summary = JSON.parse(stdout.join('\n'));
    expect(summary.projectsWithoutNext).toContain('todo/Sprint Board');
  });

  test('--waiting-days controls how stale a #waiting/ task must be to surface', async () => {
    await fs.write(
      'todo.md',
      ['# Inbox', '', '- [ ] Waiting on Bob #waiting/bob !2026-01-01'].join('\n'),
    );

    const lenient = await runCli(fs, ['--workspace', 'todo.md', '--json', 'summary', '--as-of', '2026-04-10', '--waiting-days', '1000']);
    expect(JSON.parse(lenient.stdout.join('\n')).staleWaiting).toEqual([]);

    const strict = await runCli(fs, ['--workspace', 'todo.md', '--json', 'summary', '--as-of', '2026-04-10', '--waiting-days', '1']);
    expect(JSON.parse(strict.stdout.join('\n')).staleWaiting).toHaveLength(1);
  });
});

describe('summary in a directory workspace', () => {
  test('--json carries each project file path', async () => {
    const fs = new InMemoryFileSystem();
    await fs.write('ws/inbox.md', '---\nmarkdone: 2\n---\n');
    await fs.write('ws/home-network/todo.md', '---\nmarkdone: 2\n---\n- [ ] Router\n');
    const { code, stdout } = await runCli(fs, ['--workspace', 'ws', '--json', 'summary', '--as-of', '2026-04-03']);
    expect(code).toBe(0);
    const projects = JSON.parse(stdout.join('\n')).projects;
    expect(projects).toContainEqual(expect.objectContaining({ name: 'home-network', path: 'home-network/todo.md', openCount: 1 }));
  });

  test('a workspace of unmarked .md files says so on stderr instead of reporting an empty workspace', async () => {
    const fs = new InMemoryFileSystem();
    await fs.write('ws/inbox.md', '- [ ] old inbox\n');
    await fs.write('ws/website.md', '# Website\n\n- [ ] ship it\n');
    for (const command of ['summary', 'list']) {
      const { code, stderr } = await runCli(fs, ['--workspace', 'ws', '--json', command]);
      expect(code).toBe(0);
      expect(stderr.join('\n')).toContain("needs 'markdone: 2'");
    }
  });

  test('a marked workspace prints no hint', async () => {
    const fs = new InMemoryFileSystem();
    await fs.write('ws/inbox.md', '---\nmarkdone: 2\n---\n');
    await fs.write('ws/website.md', '---\nmarkdone: 2\n---\n');
    const { stderr } = await runCli(fs, ['--workspace', 'ws', '--json', 'summary']);
    expect(stderr).toEqual([]);
  });
});

describe('the unmarked-files hint', () => {
  test('a partly migrated workspace still warns about task-like unmarked files', async () => {
    const fs = new InMemoryFileSystem();
    await fs.write('ws/inbox.md', '---\nmarkdone: 2\n---\n');
    await fs.write('ws/migrated.md', '---\nmarkdone: 2\n---\n- [ ] ok\n');
    await fs.write('ws/forgotten.md', '---\nlayout: kanban\n---\n## Next\n');
    const { code, stderr } = await runCli(fs, ['--workspace', 'ws', '--json', 'list']);
    expect(code).toBe(0);
    expect(stderr.join('\n')).toContain('look like task files but lack the marker');
  });

  test('plain unmarked notes beside marked projects do not warn', async () => {
    const fs = new InMemoryFileSystem();
    await fs.write('ws/inbox.md', '---\nmarkdone: 2\n---\n');
    await fs.write('ws/migrated.md', '---\nmarkdone: 2\n---\n- [ ] ok\n');
    await fs.write('ws/notes.md', '- [ ] plain checkbox\n');
    const { stderr } = await runCli(fs, ['--workspace', 'ws', '--json', 'list']);
    expect(stderr).toEqual([]);
  });

  test('every query command carries it, not just summary and list', async () => {
    const fs = new InMemoryFileSystem();
    await fs.write('ws/inbox.md', '- [ ] old\n');
    await fs.write('ws/website.md', '# Website\n- [ ] ship\n');
    for (const command of [['waiting'], ['overdue'], ['search', 'ship'], ['next']]) {
      const { code, stderr } = await runCli(fs, ['--workspace', 'ws', '--json', ...command]);
      expect(code).toBe(0);
      expect(stderr.join('\n')).toContain("needs 'markdone: 2'");
    }
  });

  test('a single-file workspace never prints it', async () => {
    const fs = new InMemoryFileSystem();
    await seedFileModeFixture(fs, 'file-mode', 'todo.md');
    const { stderr } = await runCli(fs, ['--workspace', 'todo.md', '--json', 'list']);
    expect(stderr).toEqual([]);
  });

  test('summary text mode lists projects without a path column', async () => {
    const fs = new InMemoryFileSystem();
    await fs.write('ws/inbox.md', '---\nmarkdone: 2\n---\n');
    await fs.write('ws/home-network/todo.md', '---\nmarkdone: 2\n---\n- [ ] Router\n');
    const { stdout } = await runCli(fs, ['--workspace', 'ws', 'summary', '--as-of', '2026-04-03']);
    expect(stdout.join('\n')).toContain('ws/home-network: 1');
  });
});
