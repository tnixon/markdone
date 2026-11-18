import type { FileSystem, OperationContext, WorkspaceSpec } from '@markdone/core';
import {
  ExternalChangeError,
  WorkspaceError,
  parseWorkspaceSpec,
  parseWorkspacesFromEnv,
  resolveWorkspaces,
  localDateString,
  lintWorkspaces,
  hasBlockingFindings,
  renderLintFindings,
} from '@markdone/core';
import { UsageError } from './errors';
import { pickTargetWorkspace } from './workspace';
import { QUERY_COMMANDS, MUTATION_COMMANDS, type CommandContext } from './commands';
import { parseFlags, getFlag } from './flagsParser';
import { buildQueryState, renderQueryResult, runOperation } from './query';
import { runMutation, renderMutationOutcome } from './mutate';
import { buildSummary, renderSummary } from './summary';

export interface CliDeps {
  fs: FileSystem;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
  env: Record<string, string | undefined>;
  now: () => Date;
}

interface GlobalOptions {
  workspaces: WorkspaceSpec[];
  json: boolean;
  owner?: string;
  in?: string;
  help: boolean;
  version: boolean;
}

// Scans the whole argv for global flags, wherever they appear — not just a
// leading run before the subcommand — so `markdone list --json` and
// `markdone --json list` both work, and so does `markdone add --help`. Safe
// because no command defines a flag named --workspace/--json/--owner/--in/
// --help/--version of its own.
function parseGlobalOptions(argv: string[]): { options: GlobalOptions; rest: string[] } {
  const workspaces: WorkspaceSpec[] = [];
  let json = false;
  let owner: string | undefined;
  let inId: string | undefined;
  let help = false;
  let version = false;
  const rest: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--workspace') {
      const value = argv[++i];
      if (value === undefined) throw new UsageError('--workspace requires a value');
      workspaces.push(parseWorkspaceSpec(value));
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--owner') {
      owner = argv[++i];
      if (owner === undefined) throw new UsageError('--owner requires a value');
    } else if (arg === '--in') {
      inId = argv[++i];
      if (inId === undefined) throw new UsageError('--in requires a value');
    } else if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--version') {
      version = true;
    } else {
      rest.push(arg);
    }
  }
  return { options: { workspaces, json, owner, in: inId, help, version }, rest };
}

// Injected at build time via esbuild's `define` (see packages/toolkit/build.mjs)
// from the publishing package's own package.json version. The fallback
// covers every other caller of this file that doesn't pass that define:
// packages/cli's own build.mjs, and this package's test suite importing
// run.ts directly.
declare const __MARKDONE_VERSION__: string | undefined;
const VERSION = typeof __MARKDONE_VERSION__ !== 'undefined' ? __MARKDONE_VERSION__ : '0.0.0-dev';

const OTHER_COMMAND_USAGE: Record<string, string> = {
  summary: 'markdone summary [--waiting-days N] [--as-of DATE]',
  lint: 'markdone lint [--strict]',
};

const USAGE = `markdone --workspace <path> [--workspace <id>=<path> ...] [--json] [--owner NAME] [--in ID] <command> [args]

Query commands: ${Object.keys(QUERY_COMMANDS).join(', ')}
Mutation commands: ${Object.keys(MUTATION_COMMANDS).join(', ')} (each supports --dry-run)
Other commands: summary [--waiting-days N] [--as-of DATE], lint [--strict]

Run 'markdone <command> --help' for a command's full usage. --version prints the CLI version.`;

export async function run(argv: string[], deps: CliDeps): Promise<number> {
  let global: GlobalOptions;
  let rest: string[];
  try {
    ({ options: global, rest } = parseGlobalOptions(argv));
  } catch (err) {
    deps.stderr((err as Error).message);
    deps.stderr(USAGE);
    return 1;
  }

  if (global.version) {
    deps.stdout(VERSION);
    return 0;
  }

  const [commandName, ...commandArgv] = rest;

  if (global.help) {
    const usage = commandName
      ? (QUERY_COMMANDS[commandName]?.usage ?? MUTATION_COMMANDS[commandName]?.usage ?? OTHER_COMMAND_USAGE[commandName])
      : undefined;
    deps.stdout(usage ?? USAGE);
    return 0;
  }

  if (!commandName) {
    deps.stderr(USAGE);
    return 1;
  }

  // A --workspace flag always wins outright over MARKDONE_WORKSPACES, no
  // merging — same precedence @markdone/mcp documents for its identical
  // env fallback. resolveWorkspaces' own MARKDONE_WORKSPACE (singular)/
  // ./todo.md fallback still applies below this if neither is given.
  const workspaces = global.workspaces.length > 0 ? global.workspaces : parseWorkspacesFromEnv(deps.env);
  if (global.workspaces.length === 0 && workspaces.length > 0 && deps.env.MARKDONE_WORKSPACE) {
    deps.stderr('Warning: MARKDONE_WORKSPACES is set, so MARKDONE_WORKSPACE is ignored');
  }

  let resolved;
  try {
    resolved = await resolveWorkspaces(workspaces, deps.fs, deps.env);
  } catch (err) {
    deps.stderr((err as Error).message);
    return err instanceof WorkspaceError ? 2 : 1;
  }

  const ctx: CommandContext = { resolved, owner: global.owner, inId: global.in };
  // The local calendar date, taken once from the injected clock so every
  // operation in this invocation agrees on what "today" is.
  const operationContext: OperationContext = { today: localDateString(deps.now()) };

  // Files that look like project files but lack `markdone: 2` are invisible
  // to every query, so say so on stderr rather than let the result look like
  // an honest empty/short one. Fires for a workspace with no marked project
  // at all (one from before marker discovery) and for a partly migrated one.
  if (commandName === 'summary' || QUERY_COMMANDS[commandName]) {
    for (const ws of resolved) {
      const report = ws.handle.discoveryReport?.();
      if (!report) continue;
      const lookAlike = report.unmarkedNotes.filter(n => n.looksLikeTaskFile).length;
      const noneMarked = report.projects.length === 0 && report.unmarkedNotes.length > 0;
      if (!noneMarked && lookAlike === 0) continue;

      const subject = noneMarked
        ? `has ${report.unmarkedNotes.length} .md file(s) but no Markdone project`
        : `has ${lookAlike} file(s) that look like task files but lack the marker, so they are not projects`;
      deps.stderr(
        `Warning: workspace '${ws.id}' ${subject} — ` +
          "a project file needs 'markdone: 2' in its frontmatter (and so does inbox.md). " +
          "'markdone lint' names the candidates and offers the edit.",
      );
    }
  }

  try {
    if (commandName === 'summary') {
      const flags = parseFlags(commandArgv);
      const waitingDaysFlag = getFlag(flags.values, 'waiting-days');
      const waitingDays = waitingDaysFlag !== undefined ? Number(waitingDaysFlag) : 7;
      if (!Number.isFinite(waitingDays)) throw new UsageError('--waiting-days must be a number');
      const asOfDate = getFlag(flags.values, 'as-of') ?? operationContext.today;
      const state = buildQueryState(resolved);
      const summary = buildSummary(state, { waitingDays, asOfDate });
      deps.stdout(global.json ? JSON.stringify(summary, null, 2) : renderSummary(summary));
      return 0;
    }

    if (commandName === 'lint') {
      const flags = parseFlags(commandArgv, new Set(['strict']));
      const strict = flags.flags.has('strict');
      const state = buildQueryState(resolved);
      const findings = await lintWorkspaces(resolved, state, deps.fs);
      deps.stdout(global.json ? JSON.stringify(findings, null, 2) : renderLintFindings(findings, strict));
      return hasBlockingFindings(findings, strict) ? 3 : 0;
    }

    const queryCommand = QUERY_COMMANDS[commandName];
    if (queryCommand) {
      const flags = parseFlags(commandArgv, queryCommand.booleanFlags);
      const input = queryCommand.build(flags, ctx);
      const state = buildQueryState(resolved);
      const result = runOperation(queryCommand.opName, state, input, operationContext);
      if (!result.ok) {
        deps.stderr(`Error [${result.error.code}]: ${result.error.message}`);
        return 2;
      }
      deps.stdout(global.json ? JSON.stringify(result.value, null, 2) : renderQueryResult(queryCommand.opName, result.value));
      return 0;
    }

    const mutationCommand = MUTATION_COMMANDS[commandName];
    if (mutationCommand) {
      const booleanFlags = new Set([...(mutationCommand.booleanFlags ?? []), 'dry-run']);
      const flags = parseFlags(commandArgv, booleanFlags);
      const dryRun = flags.flags.has('dry-run');
      const target = pickTargetWorkspace(resolved, global.in);
      const input = mutationCommand.build(flags, ctx, target.handle, target.id);
      const outcome = await runMutation(mutationCommand.opName, target.handle, input, dryRun, operationContext);
      deps.stdout(global.json ? JSON.stringify(outcome, null, 2) : renderMutationOutcome(outcome));
      return outcome.ok ? 0 : 2;
    }

    deps.stderr(`Unknown command '${commandName}'`);
    deps.stderr(USAGE);
    return 1;
  } catch (err) {
    if (err instanceof ExternalChangeError) {
      deps.stderr(err.message);
      return 2;
    }
    if (err instanceof UsageError) {
      deps.stderr(err.message);
      return 1;
    }
    if (err instanceof WorkspaceError) {
      deps.stderr(err.message);
      return 2;
    }
    throw err;
  }
}
