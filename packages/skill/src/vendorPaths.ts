// Shared by build.mjs (which copies the file) and
// src/__tests__/reference.test.ts (which checks it isn't stale): the skill
// vendors its own copy of the normative spec so a real skill install —
// which ships only the markdone/ directory, not the rest of the Markdone
// monorepo — has it available to a skill's relative links.
import { join } from 'node:path';

export function specSourcePath(monorepoRoot: string): string {
  return join(monorepoRoot, 'spec/TODO_FORMAT.md');
}

export function specVendoredPath(packageRoot: string): string {
  return join(packageRoot, 'markdone/reference/TODO_FORMAT.md');
}
