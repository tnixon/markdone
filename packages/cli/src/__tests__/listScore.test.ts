import { InMemoryFileSystem } from '@markdone/core';
import { runCli } from './helpers';

// Two workspaces, a checklist and a kanban project, with completed work in
// each so `risk` has history to draw on, and every open task carrying a ^id so
// it can be scored individually for comparison.
const ALPHA = [
  '# Alpha',
  '',
  '- [ ] Write spec !2026-10-20 ~1days $5 %2 @computer #energy/low ^spec',
  '- [ ] Review draft $3 %2 @computer @office #owner/bob ^review',
  '- [x] Past work $2 %2 ~2hrs &(2026-10-01):4hrs ^past',
  '- [-] Dropped idea ^dropped',
  '- [ ] Waiting on vendor #waiting/acme #topic ^vendor',
  '',
  '# Board',
  '',
  '## Next',
  '',
  '- [ ] Ship it !2026-10-25 ~2days $8 %3 ^ship',
  '- [ ] Polish ^polish',
  '',
  '## Done',
  '',
  '- [x] Shipped earlier $1 %3 ~1hrs &(2026-10-02):2hrs ^shipped',
].join('\n');

const BETA = ['# Beta', '', '- [ ] Beta task !2026-10-19 ~1hrs $4 %2 ^beta1', '- [ ] Other beta ^beta2'].join('\n');

type Row = { task: { id: string; checkbox: { state: string }; blockId?: string }; location: { workspaceId: string }; score?: unknown };

describe('list --score', () => {
  let fs: InMemoryFileSystem;

  beforeEach(async () => {
    fs = new InMemoryFileSystem();
    await fs.write('a.md', ALPHA);
    await fs.write('b.md', BETA);
  });

  async function listRows(...args: string[]): Promise<Row[]> {
    const { code, stdout } = await runCli(fs, ['--workspace', 'a.md', '--workspace', 'b.md', '--json', 'list', ...args]);
    expect(code).toBe(0);
    return JSON.parse(stdout.join('\n'));
  }

  // `task.id` is a per-parse counter, so it differs between two parses in one
  // process even though nothing about the task does.
  const comparable = ({ score: _score, task, ...row }: Row) => ({ ...row, task: { ...task, id: undefined } });

  test("each open task's score equals what `score --task` returns for it", async () => {
    const rows = (await listRows('--score')).filter(r => r.task.checkbox.state === 'open');
    expect(rows).toHaveLength(7);

    for (const row of rows) {
      const { code, stdout } = await runCli(fs, [
        '--workspace', 'a.md', '--workspace', 'b.md', '--in', row.location.workspaceId,
        '--json', 'score', '--task', row.task.blockId!,
      ]);
      expect(code).toBe(0);
      expect(row.score, `score for ^${row.task.blockId}`).toEqual(JSON.parse(stdout.join('\n')));
    }
  });

  test('the scores are real, not empty: importance, urgency, risk and fit come through', async () => {
    const rows = await listRows('--score');
    const spec = rows.find(r => r.task.blockId === 'spec')!;
    expect(spec.score).toMatchObject({ importance: 5, risk: 2, fit: { contexts: ['computer'], energy: 'low' } });
    expect(typeof (spec.score as { urgency: unknown }).urgency).toBe('number');
  });

  test.each([
    ['--state', ['--state', 'open']],
    ['--tag', ['--tag', 'topic']],
    ['--context', ['--context', 'computer']],
    ['--in', ['--in', 'a']],
  ])('%s gives the same rows with and without --score', async (_name, filter) => {
    const plain = await listRows(...filter);
    const scored = await listRows(...filter, '--score');
    expect(plain.length).toBeGreaterThan(0);
    expect(scored.map(comparable)).toEqual(plain.map(comparable));
    expect(scored.every(r => r.score !== undefined)).toBe(true);
  });

  test('--in scopes to that workspace only', async () => {
    const rows = await listRows('--in', 'b', '--score');
    expect(rows.map(r => r.location.workspaceId)).toEqual(['b', 'b']);
  });

  test('without --score no row carries a score', async () => {
    const { stdout } = await runCli(fs, ['--workspace', 'a.md', '--workspace', 'b.md', '--json', 'list']);
    expect(stdout.join('\n')).not.toContain('"score"');
  });

  test('human-readable output appends a compact score suffix, and only with --score', async () => {
    const scored = await runCli(fs, ['--workspace', 'a.md', 'list', '--score']);
    const specLine = scored.stdout.join('\n').split('\n').find(l => l.includes('Write spec'))!;
    expect(specLine).toMatch(/\{imp=5\.00 urg=-?\d+\.\d\d risk=2\.00\}/);

    const plain = await runCli(fs, ['--workspace', 'a.md', 'list']);
    expect(plain.stdout.join('\n')).not.toContain('imp=');
  });

  test('--score is documented in list usage', async () => {
    const { stdout } = await runCli(fs, ['list', '--help']);
    expect(stdout.join('\n')).toContain('--score');
  });
});
