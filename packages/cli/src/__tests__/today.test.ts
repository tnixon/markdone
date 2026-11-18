import { InMemoryFileSystem } from '@markdone/core';
import { runCli } from './helpers';

// "Today" is the local calendar date, not the UTC one. Vienna is UTC+2 on
// 2026-10-18 (CEST ends on the 25th), so 22:30Z on the 17th is 00:30 local on
// the 18th — the window in which a UTC-derived date is a day behind.
process.env.TZ = 'Europe/Vienna';

const LOCAL_MIDNIGHT_BOUNDARY = new Date('2026-10-17T22:30:00Z'); // 2026-10-18 00:30 local
const LOCAL_MIDDAY = new Date('2026-10-18T10:00:00Z'); // 2026-10-18 12:00 local

const WORKSPACE = [
  '# Inbox',
  '',
  '- [ ] Finish report !2026-10-20 ~1days ^report',
  '- [ ] Past due thing !2026-10-17 ^old',
  '- [ ] Next week thing !2026-10-25 ^week',
  '- [ ] Undated thing ^plain',
].join('\n');

test('the test process is running in the zone these cases assume', () => {
  expect(LOCAL_MIDNIGHT_BOUNDARY.getDate()).toBe(18);
  expect(LOCAL_MIDNIGHT_BOUNDARY.getUTCDate()).toBe(17);
});

describe.each([
  ['just after local midnight', LOCAL_MIDNIGHT_BOUNDARY],
  ['midday', LOCAL_MIDDAY],
])('with the clock at 2026-10-18 %s (local)', (_label, now) => {
  let fs: InMemoryFileSystem;
  const cli = (...argv: string[]) => runCli(fs, ['--workspace', 'todo.md', ...argv], { now: () => now });

  beforeEach(async () => {
    fs = new InMemoryFileSystem();
    await fs.write('todo.md', WORKSPACE);
  });

  test('done stamps the local date as the completion date', async () => {
    const { code } = await cli('done', '--task', 'plain');
    expect(code).toBe(0);
    expect(await fs.read('todo.md')).toContain('&(2026-10-18)');
  });

  test('done on a recurring task bases the next instance on the local date', async () => {
    await fs.write('todo.md', '# Inbox\n\n- [ ] Water plants #every/daily ^water\n');
    const { code } = await cli('done', '--task', 'water');
    expect(code).toBe(0);
    expect(await fs.read('todo.md')).toContain('!2026-10-19');
  });

  test('summary counts overdue and due-this-week against the local date', async () => {
    const { code, stdout } = await cli('--json', 'summary');
    expect(code).toBe(0);
    const summary = JSON.parse(stdout.join('\n'));
    expect(summary.asOfDate).toBe('2026-10-18');
    expect(summary.overdueCount).toBe(1); // due the 17th
    expect(summary.dueThisWeekCount).toBe(2); // due the 20th and the 25th
  });

  test("score's urgency slack is measured from the local date", async () => {
    const { code, stdout } = await cli('--json', 'score', '--task', 'report');
    expect(code).toBe(0);
    expect(JSON.parse(stdout.join('\n')).urgency).toBe(1); // 2 days to the 20th, minus 1 day of effort
  });
});
