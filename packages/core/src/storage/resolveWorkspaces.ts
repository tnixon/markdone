import type { AppState } from '../model/types';
import type { FileSystem } from './fileSystem';
import type { WorkspaceHandle } from './workspaceHandle';
import { DirectoryWorkspaceHandle } from './directoryWorkspaceHandle';
import { FileWorkspaceHandle } from './fileWorkspaceHandle';
import { WorkspaceError } from './errors';

export interface WorkspaceSpec {
  id?: string;
  path: string;
}

export interface ResolvedWorkspace {
  id: string;
  path: string;
  isDirectory: boolean;
  handle: WorkspaceHandle;
}

function defaultIdFor(specPath: string): string {
  const trimmed = specPath.replace(/\/+$/, '');
  const base = trimmed.split('/').pop() || trimmed;
  const stem = base.replace(/\.md$/i, '');
  return stem || 'workspace';
}

// Repeatable `<id>=<path>` or bare `<path>` — the same spec syntax a
// `--workspace` flag (CLI) or a `--workspace`/`MARKDONE_WORKSPACES` entry
// (MCP) takes.
export function parseWorkspaceSpec(spec: string): WorkspaceSpec {
  const eq = spec.indexOf('=');
  if (eq > 0) return { id: spec.slice(0, eq), path: spec.slice(eq + 1) };
  return { path: spec };
}

// MARKDONE_WORKSPACES=<id>=<path>,<id>=<path>,... — comma-separated since an
// env var has no repeatable-flag equivalent. Shared by the CLI and MCP
// server so both fall back to it identically when no --workspace flags are
// given; each caller applies it only when its own argv scan found nothing,
// so an explicit --workspace always wins outright over this, never merges
// with it. Returns [] if unset — distinct from the singular MARKDONE_WORKSPACE
// resolveWorkspaces falls back to below, which is a single default path, not
// a list.
export function parseWorkspacesFromEnv(env: Record<string, string | undefined>): WorkspaceSpec[] {
  if (!env.MARKDONE_WORKSPACES) return [];
  return env.MARKDONE_WORKSPACES.split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(parseWorkspaceSpec);
}

// A shell only expands `~` at the start of a word, so `id=~/vault` (from a
// flag) or a `MARKDONE_WORKSPACES` value arrives here with a literal `~`
// that would otherwise resolve to a `./~` directory under the cwd.
function expandHome(specPath: string, env: Record<string, string | undefined>): string {
  if (specPath !== '~' && !specPath.startsWith('~/')) return specPath;
  const home = env.HOME ?? env.USERPROFILE;
  if (!home) {
    throw new WorkspaceError(`Cannot expand '~' in workspace path '${specPath}' — HOME is not set`);
  }
  return home.replace(/\/+$/, '') + specPath.slice(1);
}

// Picks file mode vs directory mode the way nothing else in this package
// does (see the README) — by stat'ing the path. A path that doesn't exist
// yet falls back to its extension: no `.md` suffix reads as a new directory
// workspace (DirectoryWorkspaceHandle creates inbox.md on reload), anything
// else as a new workspace file.
export async function resolveWorkspaces(
  specs: WorkspaceSpec[],
  fs: FileSystem,
  env: Record<string, string | undefined>,
): Promise<ResolvedWorkspace[]> {
  const effective = specs.length > 0 ? specs : [{ path: env.MARKDONE_WORKSPACE ?? './todo.md' }];
  const seen = new Set<string>();
  const resolved: ResolvedWorkspace[] = [];

  for (const rawSpec of effective) {
    const spec = { ...rawSpec, path: expandHome(rawSpec.path, env) };
    const id = spec.id ?? defaultIdFor(spec.path);
    if (seen.has(id)) {
      throw new WorkspaceError(`Duplicate workspace id '${id}' — use <id>=<path> to disambiguate`);
    }
    seen.add(id);

    let isDirectory: boolean;
    try {
      isDirectory = (await fs.stat(spec.path)).isDirectory;
    } catch {
      isDirectory = !/\.md$/i.test(spec.path);
    }

    const handle: WorkspaceHandle = isDirectory
      ? new DirectoryWorkspaceHandle(id, spec.path, fs)
      : new FileWorkspaceHandle(id, spec.path, fs);

    try {
      await handle.reload();
    } catch (err) {
      throw new WorkspaceError(`Failed to load workspace '${id}' (${spec.path}): ${(err as Error).message}`);
    }
    resolved.push({ id, path: spec.path, isDirectory, handle });
  }

  return resolved;
}

// Assembles a read-only, multi-workspace `AppState` from several resolved
// handles, for running the pan-workspace queries (`getOverdueTasks`,
// `listTasks`, ...) via `runOperation`. Mutations never use this — they go
// through `applyOperation`/`previewOperation` on the specific handle that
// owns them.
export function buildQueryState(resolved: ResolvedWorkspace[]): AppState {
  return { workspaces: resolved.map(r => r.handle.toWorkspace()), activeScope: 'all' };
}
