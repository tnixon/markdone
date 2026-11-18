import { InMemoryFileSystem } from '@markdone/core';
import { run, type CliDeps } from '../run';

export { stripLeadingComment, loadCorpusFile, seedFileModeFixture, seedDirectoryModeFixture } from '@markdone/core/testing';

export interface CapturedRun {
  code: number;
  stdout: string[];
  stderr: string[];
}

const FIXED_NOW = new Date('2026-04-10T00:00:00Z');

export async function runCli(fs: InMemoryFileSystem, argv: string[], overrides: Partial<CliDeps> = {}): Promise<CapturedRun> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await run(argv, {
    fs,
    stdout: line => stdout.push(line),
    stderr: line => stderr.push(line),
    env: {},
    now: () => FIXED_NOW,
    ...overrides,
  });
  return { code, stdout, stderr };
}
