import { bundleCjs } from '../../scripts/bundleCjs.mjs';

// See scripts/bundleCjs.mjs for why this is a CJS bundle.
await bundleCjs({ entry: 'src/main.ts', outfile: 'dist/markdone-mcp.cjs' });
