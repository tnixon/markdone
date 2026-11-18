import { build } from 'esbuild';
import { chmod, readFile } from 'node:fs/promises';

// Shared by every package build that emits a self-contained CJS bundle
// (cli, mcp, toolkit). Run from the package's own directory (npm workspace
// scripts do), so `./package.json` is that package's manifest.
//
// The published version is baked in via `define`, a pure build-time string
// substitution: run.ts's/server.ts's `declare const __MARKDONE_VERSION__`
// reference becomes this literal, with no runtime fs read and no dependency
// on where the installed package ends up on disk.
//
// CJS, not ESM: @markdone/core pulls in `yaml`, whose compiled code has a
// genuinely dynamic `require()` that only a CJS bundle's real `require`
// can resolve.
export async function bundleCjs({ entry, outfile }) {
  const { version } = JSON.parse(await readFile('./package.json', 'utf-8'));
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile,
    banner: { js: '#!/usr/bin/env node' },
    define: { __MARKDONE_VERSION__: JSON.stringify(version) },
  });
  // esbuild doesn't set the executable bit; `bin` entries need it.
  await chmod(outfile, 0o755);
}
