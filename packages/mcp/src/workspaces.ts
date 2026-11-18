import type { FileSystem, ResolvedWorkspace, WorkspaceSpec } from '@markdone/core';
import { parseWorkspaceSpec, parseWorkspacesFromEnv, resolveWorkspaces } from '@markdone/core';

// Repeatable `--workspace <name>=<path>` from argv, falling back to
// MARKDONE_WORKSPACES=<name>=<path>,<name>=<path>,... from env via
// @markdone/core's parseWorkspacesFromEnv — shared with the CLI so both
// parse the env fallback identically. argv wins outright over env when both
// are present — no merging.
export function parseWorkspaceArgs(argv: string[], env: Record<string, string | undefined>): WorkspaceSpec[] {
  const specs: WorkspaceSpec[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--workspace') {
      const value = argv[++i];
      if (value === undefined) throw new Error('--workspace requires a value');
      specs.push(parseWorkspaceSpec(value));
    }
  }
  return specs.length > 0 ? specs : parseWorkspacesFromEnv(env);
}

// Resolves specs into a Map keyed by workspace id, for O(1) lookup by a tool
// call's `workspace` argument — every registry op's `workspaceId` parameter,
// and the nested `workspaceId` in a TaskLocation/TaskAddress, addresses a
// workspace by exactly this id.
//
// Unlike the CLI, an unconfigured server fails fast rather than falling back
// to a single default workspace: resolveWorkspaces' own './todo.md' fallback
// (meant for a CLI invoked from inside a vault directory) would otherwise
// have this server silently expose a workspace named 'todo' rooted at
// whatever cwd happened to launch it — surprising for a long-running process
// a client configures once and forgets about.
export async function loadNamedWorkspaces(specs: WorkspaceSpec[], fs: FileSystem): Promise<Map<string, ResolvedWorkspace>> {
  if (specs.length === 0) {
    throw new Error('No workspaces configured — pass --workspace <name>=<path> (repeatable) or set MARKDONE_WORKSPACES=<name>=<path>,...');
  }
  const resolved = await resolveWorkspaces(specs, fs, {});
  return new Map(resolved.map(r => [r.id, r]));
}
