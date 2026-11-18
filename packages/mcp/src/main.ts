import { NodeFileSystem } from '@markdone/core/node';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { parseWorkspaceArgs, loadNamedWorkspaces } from './workspaces';
import { createServer } from './server';

// Wrapped in an async function, not top-level await: the bundle is CommonJS
// (see build.mjs, same reason as @markdone/cli's main.ts), which doesn't
// support top-level await.
async function main(): Promise<void> {
  const fs = new NodeFileSystem();
  const specs = parseWorkspaceArgs(process.argv.slice(2), process.env);
  const workspaces = await loadNamedWorkspaces(specs, fs);
  const server = createServer(workspaces);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  process.stderr.write(`markdone-mcp: ${(err as Error).message}\n`);
  process.exit(1);
});
