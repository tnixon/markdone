import { UsageError } from './errors';

// A small hand-rolled tokenizer shared by every command, rather than a
// per-command option schema (node:util's parseArgs) — the operations this
// CLI wraps have five composite parameter shapes (task refs, new-task input,
// field updates, ...) that don't map onto flat option declarations, so each
// command's own builder interprets these tokens instead.
export interface ParsedFlags {
  positionals: string[];
  // Value-carrying flags, in the order given; a repeated flag accumulates.
  values: Map<string, string[]>;
  // Boolean flags that were present (by their un-negated name); --no-<name>
  // is recorded as `no-<name>` so a caller can tell "false" from "absent".
  flags: Set<string>;
}

export function parseFlags(argv: string[], booleanFlagNames: Set<string> = new Set()): ParsedFlags {
  const positionals: string[] = [];
  const values = new Map<string, string[]>();
  const flags = new Set<string>();

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (token.startsWith('--') && token.length > 2) {
      let name = token.slice(2);
      let inlineValue: string | undefined;
      const eq = name.indexOf('=');
      if (eq !== -1) {
        inlineValue = name.slice(eq + 1);
        name = name.slice(0, eq);
      }
      let negated = false;
      if (name.startsWith('no-') && booleanFlagNames.has(name.slice(3))) {
        negated = true;
        name = name.slice(3);
      }
      if (booleanFlagNames.has(name)) {
        flags.add(negated ? `no-${name}` : name);
        continue;
      }
      const value = inlineValue ?? argv[++i];
      if (value === undefined) throw new UsageError(`--${name} requires a value`);
      const list = values.get(name) ?? [];
      list.push(value);
      values.set(name, list);
    } else {
      positionals.push(token);
    }
  }

  return { positionals, values, flags };
}

export function getFlag(values: Map<string, string[]>, name: string): string | undefined {
  const list = values.get(name);
  return list?.[list.length - 1];
}

export function getFlags(values: Map<string, string[]>, name: string): string[] {
  return values.get(name) ?? [];
}

export function requireInt(value: string, flagName: string): number {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new UsageError(`${flagName} must be an integer`);
  return n;
}

export function requireNumber(value: string, flagName: string): number {
  const n = Number(value);
  if (Number.isNaN(n)) throw new UsageError(`${flagName} must be a number`);
  return n;
}
