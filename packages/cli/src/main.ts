import { NodeFileSystem } from '@markdone/core/node';
import { run } from './run';

// Wrapped in an async function rather than a top-level await: the bundle is
// built as CommonJS (see build.mjs) — esbuild's ESM output can't resolve a
// genuinely dynamic `require()` inside the `yaml` package's compiled code
// and substitutes an always-throwing shim for it, so a CJS bundle (which
// keeps Node's real `require` available at runtime) is used instead. CJS
// modules don't support top-level await.
async function main(): Promise<void> {
  const fs = new NodeFileSystem();
  const exitCode = await run(process.argv.slice(2), {
    fs,
    stdout: line => process.stdout.write(`${line}\n`),
    stderr: line => process.stderr.write(`${line}\n`),
    env: process.env,
    now: () => new Date(),
  });
  // Not process.exit(): a write to a pipe can be asynchronous, and exit()
  // discards whatever is still buffered (truncating large --json output at
  // the 64 KB pipe size). Setting exitCode lets Node exit once stdout and
  // stderr have drained.
  process.exitCode = exitCode;
}

void main();
