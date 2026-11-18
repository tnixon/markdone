import { FuzzySuggestModal, type App, type TFolder } from 'obsidian';

function overlaps(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

// Existing vault folders a user may still add as a workspace: never the
// vault root, and never one that is, contains, or sits inside a configured
// folder (the same project files would otherwise load twice).
export function selectableFolders(app: App, configured: string[]): TFolder[] {
  return app.vault
    .getAllFolders(false)
    .filter(folder => !configured.some(path => overlaps(path, folder.path)))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export class WorkspaceFolderSuggestModal extends FuzzySuggestModal<TFolder> {
  constructor(
    app: App,
    private readonly configured: string[],
    private readonly onChoose: (folder: TFolder) => void,
  ) {
    super(app);
    this.setPlaceholder('Pick an existing folder…');
  }

  getItems(): TFolder[] {
    return selectableFolders(this.app, this.configured);
  }

  getItemText(folder: TFolder): string {
    return folder.path;
  }

  onChooseItem(folder: TFolder): void {
    this.onChoose(folder);
  }
}
