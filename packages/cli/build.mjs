import { bundleCjs } from '../../scripts/bundleCjs.mjs';

// See scripts/bundleCjs.mjs for why this is a CJS bundle. The package.json
// `.cjs` extension keeps it unambiguous despite `"type": "module"`.
await bundleCjs({ entry: 'src/main.ts', outfile: 'dist/markdone.cjs' });
