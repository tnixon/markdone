// Produces the contents of markdone/reference/operations.md from the live
// operations registry. Pure — no side effects — so it can be both
// `require()`d by build.mjs (which writes the file) and imported by
// src/__tests__/reference.test.ts (which diffs the string against the
// checked-in file to catch drift).
import { toMarkdownReference } from '@markdone/core';
import { join } from 'node:path';

export function operationsReferencePath(root: string): string {
  return join(root, 'markdone/reference/operations.md');
}

export function generateOperationsReference(): string {
  return `${toMarkdownReference()}\n`;
}
