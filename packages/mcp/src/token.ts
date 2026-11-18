import { createHash } from 'node:crypto';
import type { FileChange } from '@markdone/core';

// A distinguishing marker for "no prior file" (FileChange.before === null,
// meaning the preview would create this file). Built via fromCharCode rather
// than a NUL-character literal in this source file: a literal NUL here makes
// the file look binary to git (no diff, no blame, easily mangled by editors)
// with no benefit — what actually makes the marker uncollidable with real
// file content is that it gets JSON-stringified by canonicalize() same as
// everything else, not which character is used.
const NUL = String.fromCharCode(0);
const NULL_MARKER = `${NUL}NULL${NUL}`;

// Sorted-key JSON so the same logical input hashes the same regardless of
// property insertion order — a model may emit call arguments in any order.
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
}

// A stateless confirmation token: a hash of the workspace, operation, input,
// and — the part that actually detects a concurrent edit — the exact
// `before` content of every file the preview touched, as of the moment it
// was computed. Recomputing this against freshly re-read file contents and
// comparing is the entire confirm-time concurrency check; no token state is
// kept anywhere, so a token remains valid across a server restart and
// invalid the instant any covered file's content changes underneath it.
export function computeToken(workspaceId: string, opName: string, input: Record<string, unknown>, changes: FileChange[]): string {
  const sortedChanges = [...changes].sort((a, b) => a.path.localeCompare(b.path));
  const payload = canonicalize({
    workspaceId,
    opName,
    input,
    changes: sortedChanges.map(c => ({ path: c.path, before: c.before === null ? NULL_MARKER : c.before })),
  });
  return createHash('sha256').update(payload).digest('hex');
}
