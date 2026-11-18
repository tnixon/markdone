import { Modal, Notice, TFile, type App } from 'obsidian';
import { formatDiff, parseProject, serializeProject } from '@markdone/core';

export interface ConvertPreview {
  before: string;
  after: string;
  diff: string;
  warnings: string[];
  unchanged: boolean;
}

// No operation covers this — normalization *is* the parse→serialize round
// trip (`*2hrs`→`~2hrs`, `#key(value)`→`#key/value`, `@waiting`→
// `#waiting/unknown`, canonical token order, escaping). A whole-file
// rewrite is inherent here, not a defect to guard against: unlike a task
// mutation, this is expected to touch every deprecated token in the file.
export function previewV1Conversion(before: string, filenameFallback: string): ConvertPreview {
  const { project, warnings } = parseProject(before, { filenameFallback });
  const after = serializeProject(project);
  return { before, after, diff: formatDiff(filenameFallback, before, after), warnings, unchanged: before === after };
}

// Re-checks the live content against what the preview was computed from —
// the same re-read-before-mutate discipline as write.ts's task-mutation
// path, even though this bypasses write.ts itself (there's no
// WorkspaceHandle or FileChange here, just one file's raw text).
export async function applyV1Conversion(app: App, file: TFile, preview: ConvertPreview): Promise<boolean> {
  let applied = false;
  await app.vault.process(file, data => {
    if (data !== preview.before) return data;
    applied = true;
    return preview.after;
  });
  return applied;
}

export class ConvertV1Modal extends Modal {
  constructor(
    app: App,
    private readonly file: TFile,
    private readonly preview: ConvertPreview,
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(`Convert v1 syntax — ${this.file.name}`);
    const { contentEl } = this;

    if (this.preview.unchanged) {
      contentEl.createEl('p', { text: 'No v1 syntax found — nothing to convert.' });
      return;
    }

    if (this.preview.warnings.length > 0) {
      contentEl.createEl('p', { text: 'Normalizations:' });
      const list = contentEl.createEl('ul');
      for (const warning of this.preview.warnings) list.createEl('li', { text: warning });
    }

    contentEl.createEl('pre', { cls: 'markdone-diff', text: this.preview.diff });

    const buttons = contentEl.createDiv({ cls: 'markdone-modal-buttons' });
    buttons.createEl('button', { text: 'Cancel' }).onclick = () => this.close();
    const apply = buttons.createEl('button', { text: 'Apply', cls: 'mod-cta' });
    apply.onclick = async () => {
      const applied = await applyV1Conversion(this.app, this.file, this.preview);
      new Notice(
        applied
          ? `Markdone: converted ${this.file.name} to v2 syntax`
          : `Markdone: ${this.file.name} changed since this preview was computed — reopen the command and try again`,
      );
      this.close();
    };
  }
}
