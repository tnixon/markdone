import type { ResolvedWorkspace, WorkspaceHandle } from '@markdone/core';
import { UsageError } from './errors';

export type { ResolvedWorkspace } from '@markdone/core';

// A project locator is its zero-based index, its project path (the
// workspace-relative path without `.md`, e.g. `home-network/todo` — what
// `projects:` ordering entries use), or its name. A path is always
// unambiguous; a name shared by several projects is an error naming their
// paths, so the caller can retry with one.
export function resolveProjectIndex(handle: WorkspaceHandle, locator: string): number | undefined {
  const projects = handle.listProjects();
  if (/^\d+$/.test(locator)) {
    const idx = Number(locator);
    return idx < projects.length ? idx : undefined;
  }

  const wanted = locator.replace(/\.md$/i, '');
  const byPath = projects.findIndex(p => p.sourcePath?.replace(/\.md$/i, '') === wanted);
  if (byPath !== -1) return byPath;

  const matches = projects.map((p, i) => ({ p, i })).filter(({ p }) => p.name === locator);
  if (matches.length > 1) {
    const paths = matches.map(({ p }) => p.sourcePath ?? p.name).join(', ');
    throw new UsageError(`Project name '${locator}' is ambiguous (${paths}) — use its path`);
  }
  return matches.length === 1 ? matches[0].i : undefined;
}

// Every mutation, and any query that needs a specific project, targets
// exactly one workspace. --in <id> disambiguates when several --workspace
// were given; with only one loaded, it's implied. This disambiguation UX is
// CLI-specific — an MCP tool call names its workspace directly, with nothing
// to pick between.
export function pickTargetWorkspace(resolved: ResolvedWorkspace[], inId: string | undefined): ResolvedWorkspace {
  if (inId !== undefined) {
    const found = resolved.find(r => r.id === inId);
    if (!found) throw new UsageError(`No such workspace '${inId}' (see --in)`);
    return found;
  }
  if (resolved.length === 1) return resolved[0];
  throw new UsageError('Multiple workspaces given — specify --in <id> to pick one');
}
