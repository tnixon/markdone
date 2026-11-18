import { Notice, PluginSettingTab, Setting, type App, type TFolder } from 'obsidian';
import { CHIP_KINDS, type ChipKind, type ChipSettings } from './decorate/spans';
import { WorkspaceFolderSuggestModal } from './folderSuggest';
import type MarkdonePlugin from './main';

export interface MarkdoneSettings {
  // Vault-relative paths, one per configured directory-mode workspace.
  workspaceFolders: string[];
  // Identifies the user, for filtering/highlighting their own tasks in the
  // view. Never written to a file: per spec, `#owner/` is written only when
  // a caller names an owner, and an inherited default is not that.
  defaultOwner: string;
  chipTypes: ChipSettings;
}

export const DEFAULT_SETTINGS: MarkdoneSettings = {
  workspaceFolders: [],
  defaultOwner: '',
  chipTypes: Object.fromEntries(CHIP_KINDS.map(kind => [kind, true])) as ChipSettings,
};

const CHIP_LABELS: Record<ChipKind, string> = {
  due: 'Due date (!)',
  defer: 'Defer date (>)',
  context: 'Context (@)',
  value: 'Value ($)',
  complexity: 'Complexity (%)',
  effort: 'Effort (~)',
  actual: 'Actual (&)',
  owner: 'Owner (#owner/)',
  waiting: 'Waiting-for (#waiting/)',
};

// Case-insensitive, matching how core's DirectoryWorkspaceHandle finds it.
function hasInbox(folder: TFolder): boolean {
  return folder.children.some(child => child.name.toLowerCase() === 'inbox.md');
}

export class MarkdoneSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly plugin: MarkdonePlugin,
  ) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    this.displayWorkspaceFolders(containerEl);

    new Setting(containerEl)
      .setName('Default owner')
      .setDesc(
        'Identifies you, for filtering and highlighting your own tasks in the ' +
          'Markdone view. Never written to a file — an inherited default is not ' +
          'the same as an explicit #owner/ tag.',
      )
      .addText(text => {
        text.setValue(this.plugin.settings.defaultOwner);
        text.onChange(async (value: string) => {
          this.plugin.settings.defaultOwner = value.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl).setName('Chip types').setHeading();
    containerEl.createEl('p', {
      text: "Show or hide each token's decoration in Live Preview and Reading view.",
      cls: 'setting-item-description',
    });

    for (const kind of CHIP_KINDS) {
      new Setting(containerEl).setName(CHIP_LABELS[kind]).addToggle(toggle => {
        toggle.setValue(this.plugin.settings.chipTypes[kind]);
        toggle.onChange(async (value: boolean) => {
          this.plugin.settings.chipTypes[kind] = value;
          await this.plugin.saveSettings();
          this.plugin.refreshDecorations();
        });
      });
    }
  }

  private displayWorkspaceFolders(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName('Workspace folders')
      .setDesc(
        'Each is a directory-mode Markdone workspace (an inbox.md, project notes, ' +
          'and an optional _markdone.md). Pick folders that already exist in the ' +
          'vault; one without an inbox.md gets one. Create the folder in Obsidian first.',
      );

    for (const folder of this.plugin.settings.workspaceFolders) {
      const row = new Setting(containerEl).setName(folder);
      if (!this.app.vault.getFolderByPath(folder)) {
        row.setDesc('Folder not found in vault. Skipped until it exists.');
      }
      row.addExtraButton(button =>
        button
          .setIcon('x')
          .setTooltip('Remove')
          .onClick(() => void this.applyFolders(this.currentFolders().filter(f => f !== folder))),
      );
    }

    new Setting(containerEl).addButton(button =>
      button.setButtonText('Add folder…').onClick(() => {
        new WorkspaceFolderSuggestModal(this.app, this.currentFolders(), picked => {
          void this.addFolder(picked);
        }).open();
      }),
    );
  }

  // Read at click time, not captured at render time, so a click that lands
  // before an earlier change has re-rendered still builds on the latest list.
  private currentFolders(): string[] {
    return this.plugin.settings.workspaceFolders;
  }

  private async addFolder(picked: TFolder): Promise<void> {
    if (!(await this.applyFolders([...this.currentFolders(), picked.path]))) return;
    new Notice(
      hasInbox(picked)
        ? `Markdone: added workspace ${picked.path}`
        : `Markdone: initialized workspace in ${picked.path}`,
    );
  }

  // Returns whether the change was applied; on failure tells the user and
  // leaves the list as it was.
  private async applyFolders(folders: string[]): Promise<boolean> {
    try {
      await this.plugin.setWorkspaceFolders(folders);
    } catch (error) {
      new Notice(`Markdone: could not update workspace folders: ${String(error)}`);
      return false;
    }
    this.display();
    return true;
  }
}
