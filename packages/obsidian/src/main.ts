import { MarkdownView, Notice, Plugin, TAbstractFile, editorInfoField, type Editor, type MarkdownFileInfo } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import { DEFAULT_SETTINGS, MarkdoneSettingTab, type MarkdoneSettings } from './settings';
import { WorkspaceManager } from './workspaces';
import { createMarkdoneViewPlugin, refreshMarkdoneDecorations } from './decorate/livePreview';
import { decorateReadingView } from './decorate/readingView';
import { bindNoteApply, enhanceMarkdoneNote, type InteractionDeps } from './decorate/interact';
import { loadDefaultsFor } from './noteOps';
import { isMarkdoneNote, noteMarkerStatus } from './marker';
import { MarkdoneView, VIEW_TYPE_MARKDONE } from './view/markdoneView';
import { insertBlockIdOnCurrentLine } from './commands/insertBlockId';
import { previewV1Conversion, ConvertV1Modal } from './commands/convertV1Syntax';
import { lintAllWorkspaces, openLintResultsModal } from './commands/lintWorkspace';
import { todayIso } from './today';

export default class MarkdonePlugin extends Plugin {
  settings: MarkdoneSettings = DEFAULT_SETTINGS;
  // Assigned in onload(), not the constructor — Obsidian's plugin lifecycle
  // makes onload the true initialization point.
  workspaceManager!: WorkspaceManager;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.workspaceManager = new WorkspaceManager(this.app, () => this.refreshMarkdoneView());
    await this.workspaceManager.configure(this.settings.workspaceFolders);
    const missing = this.workspaceManager.missingFolders();
    if (missing.length > 0) {
      new Notice(`Markdone: workspace folders not found in vault: ${missing.join(', ')}`);
    }

    this.registerVaultEvents();
    this.registerEditorExtension(
      createMarkdoneViewPlugin(
        () => this.settings.chipTypes,
        todayIso,
        view => {
          const path = view.state.field(editorInfoField, false)?.file?.path;
          return path !== undefined && isMarkdoneNote(this.app, path);
        },
      ),
    );

    // Only a note whose frontmatter carries a supported `markdone` marker is
    // decorated or made interactive — checked through the metadata cache.
    const isMarkdone = (path: string) => isMarkdoneNote(this.app, path);
    const defaultsFor: InteractionDeps['defaultsFor'] = path =>
      loadDefaultsFor(this.app, this.workspaceManager.list().map(w => w.folder), path);
    const interactions: InteractionDeps = {
      defaultsFor,
      apply: bindNoteApply(this.app, defaultsFor),
      // Reload just the workspace containing the note (debounced like any
      // vault change under it); a note outside every workspace has none.
      onConflict: path => this.workspaceManager.handleVaultEvent(path),
      notify: message => void new Notice(message),
    };
    this.registerMarkdownPostProcessor(async (el, ctx) => {
      if (!isMarkdone(ctx.sourcePath)) return;
      // Already gated just above; no second check inside.
      decorateReadingView(el, ctx, this.settings.chipTypes, todayIso());
      try {
        await enhanceMarkdoneNote(el, ctx, interactions);
      } catch (error) {
        // Never leave a rejection in Obsidian's render pipeline: decoration
        // above already applied, only interactivity is lost for this section.
        console.error('Markdone: could not enable interaction for a section', error);
      }
    });
    // The marker can be added to or removed from a note while it is open:
    // redraw its editor decorations and re-render its Reading view.
    const lastMarker = new Map<string, string>();
    this.registerEvent(
      this.app.metadataCache.on('changed', file => {
        // The metadata cache fires on every edit; only a change in the
        // note's marker status warrants redrawing anything.
        const status = noteMarkerStatus(this.app, file.path);
        if (lastMarker.get(file.path) === status) return;
        lastMarker.set(file.path, status);
        this.refreshDecorations();
        for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
          const view = leaf.view as MarkdownView;
          if (view.file?.path === file.path && view.getMode() === 'preview') view.previewMode.rerender(true);
        }
      }),
    );

    this.registerView(VIEW_TYPE_MARKDONE, leaf => new MarkdoneView(leaf, this));
    this.addRibbonIcon('checkmark', 'Open Markdone', () => void this.activateView());

    this.addCommand({
      id: 'markdone-open-view',
      name: 'Open Markdone view',
      callback: () => void this.activateView(),
    });

    this.addCommand({
      id: 'markdone-insert-block-id',
      name: 'Insert ^id on current task',
      editorCallback: (editor: Editor) => {
        const result = insertBlockIdOnCurrentLine(editor);
        if (result === 'not-a-task') new Notice('Markdone: cursor is not on a task line');
        else if (result === 'already-has-id') new Notice('Markdone: this task already has a ^id');
      },
    });

    this.addCommand({
      id: 'markdone-convert-v1-syntax',
      name: 'Convert v1 syntax in this file to v2',
      editorCallback: async (_editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
        const file = ctx.file;
        if (!file) return;
        const before = await this.app.vault.read(file);
        const preview = previewV1Conversion(before, file.basename);
        new ConvertV1Modal(this.app, file, preview).open();
      },
    });

    this.addCommand({
      id: 'markdone-lint-workspace',
      name: 'Run lint on workspace',
      callback: async () => {
        const findings = await lintAllWorkspaces(this.app, this.workspaceManager);
        openLintResultsModal(this.app, findings);
      },
    });

    this.addSettingTab(new MarkdoneSettingTab(this.app, this));
  }

  onunload(): void {
    this.workspaceManager?.dispose();
    // Everything else — the view, commands, editor extension, post
    // processor, vault event listeners, settings tab — is registered
    // through register*/addCommand/addSettingTab, which Obsidian's own
    // Plugin lifecycle tears down. Deliberately does not detach any open
    // Markdone view leaf; that's the user's to close, not this plugin's.
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<MarkdoneSettings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...data,
      chipTypes: { ...DEFAULT_SETTINGS.chipTypes, ...data?.chipTypes },
    };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async setWorkspaceFolders(folders: string[]): Promise<void> {
    this.settings.workspaceFolders = folders;
    await this.saveSettings();
    await this.workspaceManager.configure(folders);
    this.refreshMarkdoneView();
  }

  refreshMarkdoneView(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_MARKDONE)) {
      if (leaf.view instanceof MarkdoneView) leaf.view.refresh();
    }
  }

  // Dispatched into every open editor when a chip-type toggle changes in
  // settings, so decoration updates immediately rather than only on the
  // next edit or a reopen.
  refreshDecorations(): void {
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view as MarkdownView;
      // @ts-expect-error, not typed — see Obsidian's docs on communicating
      // with editor extensions.
      const editorView = view.editor?.cm as EditorView | undefined;
      if (editorView) refreshMarkdoneDecorations(editorView);
    }
  }

  private registerVaultEvents(): void {
    const onEvent = (file: TAbstractFile) => this.workspaceManager.handleVaultEvent(file.path);
    this.registerEvent(this.app.vault.on('modify', onEvent));
    this.registerEvent(this.app.vault.on('delete', onEvent));
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        this.workspaceManager.handleVaultEvent(file.path);
        this.workspaceManager.handleVaultEvent(oldPath);
      }),
    );
    // 'create' fires for every pre-existing file while Obsidian's initial
    // vault scan is still running — deferred to onLayoutReady so loading
    // this plugin doesn't queue a reload per file in a large vault.
    this.app.workspace.onLayoutReady(() => {
      this.registerEvent(this.app.vault.on('create', onEvent));
    });
  }

  private async activateView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_MARKDONE);
    if (existing.length > 0) {
      await workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: VIEW_TYPE_MARKDONE, active: true });
    await workspace.revealLeaf(leaf);
  }
}
