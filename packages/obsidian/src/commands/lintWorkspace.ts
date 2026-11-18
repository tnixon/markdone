import { Modal, type App } from 'obsidian';
import { buildQueryState, lintWorkspaces, renderLintFindings, type LintFinding, type ResolvedWorkspace } from '@markdone/core';
import { VaultFileSystem } from '../vaultFileSystem';
import type { WorkspaceManager } from '../workspaces';

// Same rules `markdone lint` runs — both call `lintWorkspaces` from
// @markdone/core rather than each keeping its own copy (see the plan's §1d).
export async function lintAllWorkspaces(app: App, workspaceManager: WorkspaceManager): Promise<LintFinding[]> {
  const resolved: ResolvedWorkspace[] = workspaceManager
    .list()
    .map(w => ({ id: w.id, path: w.folder, isDirectory: true, handle: w.handle }));
  const state = buildQueryState(resolved);
  return lintWorkspaces(resolved, state, new VaultFileSystem(app));
}

export class LintResultsModal extends Modal {
  constructor(
    app: App,
    private readonly findings: LintFinding[],
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText('Markdone lint');
    const { contentEl } = this;
    if (this.findings.length === 0) {
      contentEl.createEl('p', { text: 'No findings.' });
      return;
    }
    contentEl.createEl('pre', { cls: 'markdone-lint-results', text: renderLintFindings(this.findings, false) });
  }
}

export function openLintResultsModal(app: App, findings: LintFinding[]): void {
  new LintResultsModal(app, findings).open();
}
