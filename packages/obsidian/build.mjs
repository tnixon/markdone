import { build } from 'esbuild';

// Two deliberate departures from every other build.mjs in this repo:
//
// - format: 'cjs' — Obsidian loads a plugin's main.js as CommonJS, not ESM.
// - platform: 'browser', NOT 'node' — @markdone/core's only dependency,
//   `yaml`, has a `browser` field in its package.json pointing at a build
//   with no dynamic `require()`. `platform: 'node'` (what packages/cli and
//   packages/mcp use) would instead pull in yaml's Node build, whose
//   compiled code has a genuinely dynamic `require()` call — harmless under
//   real Node, but Obsidian's mobile runtime has no `require` at all, so
//   that path would throw the first time a workspace file's frontmatter
//   was parsed. `platform: 'browser'` makes esbuild resolve `yaml` via its
//   `browser` field instead, which has no such call.
//
// obsidian/electron/CodeMirror are supplied by the Obsidian runtime, never
// bundled — bundling a second copy of CodeMirror would silently break any
// other plugin's editor extensions sharing the same EditorView.
await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*'],
  outfile: 'main.js',
});
