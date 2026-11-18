import { build } from 'esbuild';
import { copyFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Resolve everything from this file's location so the build works no matter
// which directory it's invoked from (not just via `npm run` in the package).
const packageRoot = fileURLToPath(new URL('.', import.meta.url));
process.chdir(packageRoot);

// Unlike the plugin this package replaces, the skill doesn't vendor CLI/MCP
// bundles — it assumes `markdone`/`markdone-mcp` are on PATH via
// @markdone/toolkit. This build only regenerates the two generated
// reference files below.

// Regenerate the operations reference table from the live registry.
// `@markdone/core` publishes raw TS (main: "./src/index.ts"), which plain
// Node can't resolve, so bundle src/generateOperationsReference.ts to a
// throwaway CJS file and `require()` it — that gives the executed code
// Node's real `require`/`__filename`, which a `new Function(...)` eval
// would not — then delete the temp file.
const tmpEntry = '.generate-operations-reference.tmp.cjs';
await build({
  entryPoints: ['src/generateOperationsReference.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: tmpEntry,
});
let outPath;
try {
  const generator = createRequire(import.meta.url)(`./${tmpEntry}`);
  outPath = generator.operationsReferencePath(process.cwd());
  await writeFile(outPath, generator.generateOperationsReference());
} finally {
  await rm(tmpEntry);
}
console.log(`Wrote ${outPath}`);

// Vendor a copy of the normative spec into the skill's reference/ folder.
// A real skill install ships only the markdone/ directory, not the rest of
// the Markdone monorepo, so a skill link to spec/TODO_FORMAT.md would 404
// for every installed user even though it resolves fine in this repo.
// Paths mirror src/vendorPaths.ts (kept in sync by reference.test.ts).
const specSource = '../../spec/TODO_FORMAT.md';
const specDest = 'markdone/reference/TODO_FORMAT.md';
await copyFile(specSource, specDest);
console.log(`Wrote ${specDest}`);
