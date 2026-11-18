// Proves the *packaged, installed* artifact works — not just the source.
// Every other test in this repo runs against InMemoryFileSystem with no real
// disk or subprocess I/O; this is deliberately the one exception, since
// nothing in-memory can prove `npm install @markdone/toolkit` actually
// produces working binaries on someone else's machine. Excluded from the
// default `test` script (see vitest.config.ts's exclude) — this is real
// npm pack + npm install + subprocess spawns, ~5-15s, run via `test:smoke`.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, copyFileSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, '..');
const repoRoot = path.resolve(packageRoot, '../..');
const { version } = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf-8'));

let tmpRoot: string;
let cliBin: string;
let mcpBin: string;
let fixturePath: string;

beforeAll(() => {
  tmpRoot = mkdtempSync(path.join(tmpdir(), 'markdone-toolkit-smoke-'));
  const packDir = path.join(tmpRoot, 'pack');
  const installDir = path.join(tmpRoot, 'install');
  const cacheDir = path.join(tmpRoot, 'npm-cache');
  mkdirSync(packDir, { recursive: true });
  mkdirSync(installDir, { recursive: true });

  // An isolated npm cache: keeps this test hermetic against whatever state
  // (or breakage) the host machine's real npm cache happens to be in.
  const npmEnv = { ...process.env, npm_config_cache: cacheDir };

  // Packs the already-built dist/ — `npm run build` must run before this
  // (package.json's test:smoke script assumes dist/ exists; see the CI
  // workflow, which builds first).
  execFileSync('npm', ['pack', '--json', '--pack-destination', packDir], { cwd: packageRoot, env: npmEnv });
  const [tarball] = readdirSync(packDir);
  const tarballPath = path.join(packDir, tarball);

  // -g --prefix, not a plain local --prefix install, so npm lays bins out
  // at <installDir>/bin/<name> the same way a real `npm install -g` would
  // — confirmed empirically, not assumed (a plain --prefix install instead
  // nests bins under node_modules/.bin).
  execFileSync('npm', ['install', '-g', '--prefix', installDir, tarballPath], { env: npmEnv });

  cliBin = path.join(installDir, 'bin', 'markdone');
  mcpBin = path.join(installDir, 'bin', 'markdone-mcp');

  fixturePath = path.join(tmpRoot, 'file-mode.md');
  copyFileSync(path.join(repoRoot, 'spec/corpus/file-mode.md'), fixturePath);
});

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('installed markdone CLI', () => {
  test('--version reports the published version', () => {
    const stdout = execFileSync(cliBin, ['--version'], { encoding: 'utf-8' }).trim();
    expect(stdout).toBe(version);
  });

  test('--workspace <fixture> summary runs against a real workspace file', () => {
    const stdout = execFileSync(cliBin, ['--workspace', fixturePath, 'summary'], { encoding: 'utf-8' });
    expect(stdout.trim()).not.toBe('');
  });
});

describe('installed markdone-mcp server', () => {
  test('speaks MCP over stdio: lists tools and answers a real query', async () => {
    const transport = new StdioClientTransport({
      command: mcpBin,
      env: { ...process.env, MARKDONE_WORKSPACES: `smoke=${fixturePath}` },
    });
    const client = new Client({ name: 'markdone-toolkit-smoke-test', version: '1.0.0' });
    await client.connect(transport);
    try {
      const { tools } = await client.listTools();
      expect(tools.some(t => t.name === 'markdone_list_tasks')).toBe(true);

      const result = await client.callTool({ name: 'markdone_list_tasks', arguments: { workspace: 'smoke' } });
      expect(result.isError).toBeFalsy();
      const content = result.content as Array<{ type: string; text?: string }>;
      const parsed = JSON.parse(content.map(c => c.text ?? '').join('\n'));
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThan(0); // file-mode.md has real tasks
    } finally {
      await client.close();
    }
  });
});
