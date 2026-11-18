import { InMemoryFileSystem } from '@markdone/core';
import { runCli, seedFileModeFixture, seedDirectoryModeFixture } from './helpers';

describe('query commands — file mode (spec/corpus/file-mode.md)', () => {
  let fs: InMemoryFileSystem;

  beforeEach(async () => {
    fs = new InMemoryFileSystem();
    await seedFileModeFixture(fs, 'file-mode', 'todo.md');
  });

  test('context returns tasks with the matching @context', async () => {
    const { code, stdout } = await runCli(fs, ['--workspace', 'todo.md', '--json', 'context', 'errands']);
    expect(code).toBe(0);
    const tasks = JSON.parse(stdout.join('\n'));
    expect(tasks).toHaveLength(1);
    expect(tasks[0].task.text).toBe('Buy groceries');
  });

  test('tag returns tasks with the matching #tag', async () => {
    const { code, stdout } = await runCli(fs, ['--workspace', 'todo.md', '--json', 'tag', 'research']);
    expect(code).toBe(0);
    const tasks = JSON.parse(stdout.join('\n'));
    expect(tasks).toHaveLength(1);
    expect(tasks[0].task.text).toBe('Competitive analysis');
  });

  test('overdue returns incomplete tasks past the given date', async () => {
    // "Buy groceries" is due 2026-04-01; "Wireframe new landing page" is due
    // 2026-04-05 — as-of 04-03 puts only the first one in the past.
    const { code, stdout } = await runCli(fs, ['--workspace', 'todo.md', '--json', 'overdue', '--as-of', '2026-04-03']);
    expect(code).toBe(0);
    const tasks = JSON.parse(stdout.join('\n'));
    expect(tasks.map((t: { task: { text: string } }) => t.task.text)).toEqual(['Buy groceries']);
  });

  test('due returns incomplete tasks in the given range', async () => {
    const { code, stdout } = await runCli(fs, [
      '--workspace', 'todo.md', '--json', 'due', '--start', '2026-04-01', '--end', '2026-04-10',
    ]);
    expect(code).toBe(0);
    const tasks = JSON.parse(stdout.join('\n'));
    expect(tasks).toHaveLength(2);
  });

  test('search matches task text', async () => {
    const { code, stdout } = await runCli(fs, ['--workspace', 'todo.md', '--json', 'search', 'groceries']);
    expect(code).toBe(0);
    expect(JSON.parse(stdout.join('\n'))).toHaveLength(1);
  });

  test('waiting is empty when no task carries #waiting/', async () => {
    const { code, stdout } = await runCli(fs, ['--workspace', 'todo.md', 'waiting']);
    expect(code).toBe(0);
    expect(stdout.join('\n')).toBe('No tasks.');
  });

  test('list filters by checkbox state', async () => {
    const { code, stdout } = await runCli(fs, ['--workspace', 'todo.md', '--json', 'list', '--state', 'done']);
    expect(code).toBe(0);
    expect(JSON.parse(stdout.join('\n'))).toHaveLength(3);
  });

  test('accuracy reports no data when no completed task has both an estimate and an actual duration', async () => {
    const { code, stdout } = await runCli(fs, ['--workspace', 'todo.md', 'accuracy']);
    expect(code).toBe(0);
    expect(stdout.join('\n')).toContain('No completed tasks');
  });

  test('score computes the four signals for one task, human-readable', async () => {
    const { code, stdout } = await runCli(fs, [
      '--workspace', 'todo.md', 'score', '--project', 'Errands', '--index', '0',
    ]);
    expect(code).toBe(0);
    const out = stdout.join('\n');
    expect(out).toContain('importance:');
    expect(out).toContain('urgency:');
  });

  test('an unknown query operand surfaces the operation error and exits 2', async () => {
    const { code, stderr } = await runCli(fs, [
      '--workspace', 'todo.md', 'score', '--project', 'Errands', '--index', '999',
    ]);
    expect(code).toBe(2);
    expect(stderr.join('\n')).toContain('TASK_NOT_FOUND');
  });
});

describe('query commands — directory mode (spec/corpus/directory-mode/)', () => {
  let fs: InMemoryFileSystem;

  beforeEach(async () => {
    fs = new InMemoryFileSystem();
    await seedDirectoryModeFixture(fs, 'workspace');
  });

  test('list --owner filters by effective owner (explicit #owner/ tag)', async () => {
    const { code, stdout } = await runCli(fs, ['--workspace', 'workspace', '--json', 'list', '--owner', 'bob']);
    expect(code).toBe(0);
    const tasks = JSON.parse(stdout.join('\n'));
    expect(tasks.map((t: { task: { text: string } }) => t.task.text)).toEqual(['Wireframe landing page']);
  });

  test('list --project scopes by display name, resolved against the loaded projects', async () => {
    const { code, stdout } = await runCli(fs, [
      '--workspace', 'workspace', '--json', 'list', '--project', 'Reading List',
    ]);
    expect(code).toBe(0);
    const tasks = JSON.parse(stdout.join('\n'));
    expect(tasks).toHaveLength(2);
  });

  test('next picks the highest value/complexity ratio task per context', async () => {
    const { code, stdout } = await runCli(fs, ['--workspace', 'workspace', '--json', 'next']);
    expect(code).toBe(0);
    const map = JSON.parse(stdout.join('\n'));
    // "Wireframe landing page" carries @computer, so it wins that bucket
    // rather than __inbox__ (getNextActions keys by bare context name);
    // among the context-less tasks, "Competitive analysis" ($6/%5 = 1.2)
    // has the best ratio.
    expect(map.computer.task.text).toBe('Wireframe landing page');
    expect(map.__inbox__.task.text).toBe('Competitive analysis');
  });

  test('waiting finds a #waiting/ task in a directory-mode checklist project', async () => {
    // The corpus fixture's only #waiting/ task sits in an auxiliary kanban
    // section (an H2 not named in `columns:`), which — like every
    // location-based query — getWaitingFor can't see; only column and
    // checklist tasks carry a queryable TaskLocation. This exercises the
    // CLI's directory-mode wiring against a task that a query can reach.
    const dirFs = new InMemoryFileSystem();
    await dirFs.write('ws/inbox.md', '---\nmarkdone: 2\n---\n');
    await dirFs.write('ws/tasks.md', '---\nmarkdone: 2\n---\n# Tasks\n\n- [ ] Waiting on Bob #waiting/bob !2026-01-01\n');

    const { code, stdout } = await runCli(dirFs, ['--workspace', 'ws', '--json', 'waiting']);
    expect(code).toBe(0);
    const tasks = JSON.parse(stdout.join('\n'));
    expect(tasks).toHaveLength(1);
    expect(tasks[0].task.text).toBe('Waiting on Bob');
  });
});
