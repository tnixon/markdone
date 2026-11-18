// Regression test for stdout truncation on pipes: main.ts used to call
// process.exit() right after run() returned, and on macOS a write to a pipe
// is asynchronous, so anything the reader hadn't yet drained (past the 64 KB
// pipe buffer) was discarded. Spawns the *built* CLI with stdout as a pipe and
// a deliberately slow reader. (On Linux Node writes to pipes synchronously,
// so this can only fail on macOS.) Needs `npm run build:toolkit` first.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const cliBin = path.resolve(here, '../dist/markdone.cjs');

const TASK_COUNT = 800;
const READ_DELAY_MS = 500;

let tmpRoot: string;
let workspacePath: string;

beforeAll(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'markdone-pipe-smoke-'));
  workspacePath = path.join(tmpRoot, 'big.md');
  const tasks = Array.from(
    { length: TASK_COUNT },
    (_, i) => `- [ ] Task number ${i} with a reasonably long description to bulk up the output !2026-12-${String((i % 28) + 1).padStart(2, '0')} @computer $${i % 9} %${(i % 5) + 1} ~${(i % 4) + 1}hrs ^t${i}`,
  );
  writeFileSync(workspacePath, ['---', 'markdone: 2', '---', '', '# Big', '', ...tasks, ''].join('\n'));
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

// Reads the child's stdout only after READ_DELAY_MS, so the child has long
// since finished writing into a full pipe buffer by the time anything drains it.
function runThroughSlowPipe(args: string[]): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cliBin, args, { stdio: ['ignore', 'pipe', 'inherit'] });
    const chunks: Buffer[] = [];
    child.stdout.pause();
    setTimeout(() => {
      child.stdout.on('data', chunk => chunks.push(chunk));
      child.stdout.resume();
    }, READ_DELAY_MS);
    child.on('error', reject);
    child.on('close', code => resolve({ stdout: Buffer.concat(chunks).toString('utf-8'), code }));
  });
}

describe('stdout through a pipe', () => {
  test('--json list larger than the 64 KB pipe buffer arrives in full', async () => {
    const { stdout, code } = await runThroughSlowPipe(['--workspace', workspacePath, '--json', 'list']);
    expect(code).toBe(0);
    expect(Buffer.byteLength(stdout)).toBeGreaterThanOrEqual(200 * 1024);
    expect(JSON.parse(stdout)).toHaveLength(TASK_COUNT);
  });

  test('--json list --score on the same workspace also arrives in full, every row scored', async () => {
    const { stdout, code } = await runThroughSlowPipe(['--workspace', workspacePath, '--json', 'list', '--score']);
    expect(code).toBe(0);
    expect(Buffer.byteLength(stdout)).toBeGreaterThanOrEqual(200 * 1024);
    const rows = JSON.parse(stdout) as Array<{ score?: { importance: number } }>;
    expect(rows).toHaveLength(TASK_COUNT);
    expect(rows.every(r => r.score !== undefined)).toBe(true);
  });
});
