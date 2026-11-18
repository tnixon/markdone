import { copyFile } from 'node:fs/promises';
import { bundleCjs } from '../../scripts/bundleCjs.mjs';

// Bundles the CLI and MCP server sources into this package's own dist/, so
// the published package needs neither @markdone/cli nor @markdone/mcp.
await bundleCjs({ entry: '../cli/src/main.ts', outfile: 'dist/markdone.cjs' });
await bundleCjs({ entry: '../mcp/src/main.ts', outfile: 'dist/markdone-mcp.cjs' });

// npm only packs files inside the package directory, so stage the repo's
// LICENSE next to the published bundles.
await copyFile('../../LICENSE', 'dist/LICENSE');
