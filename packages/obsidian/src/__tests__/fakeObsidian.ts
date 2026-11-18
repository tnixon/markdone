// A minimal in-memory stand-in for the pieces of the 'obsidian' runtime this
// package's code touches. The real 'obsidian' npm package ships type
// declarations only (its package.json has `"main": ""` — the actual classes
// come from the running Obsidian app), so `vitest.config.ts` aliases the
// module specifier 'obsidian' to this file for every test in this package.
// It has no effect on the production bundle: build.mjs marks 'obsidian'
// external, so the real app's classes are what actually run there.
//
// Extend this incrementally as new tests need more of the surface — it is
// deliberately not a full obsidian.d.ts implementation.

export class TAbstractFile {
  constructor(public path: string) {}
  get name(): string {
    const slash = this.path.lastIndexOf('/');
    return slash === -1 ? this.path : this.path.slice(slash + 1);
  }
}

// Mirrors the real helper's slash handling: backslashes become slashes,
// repeated slashes collapse, and leading/trailing slashes are dropped.
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '') || '/';
}

export class TFile extends TAbstractFile {
  stat = { mtime: 0, ctime: 0, size: 0 };
}

export class TFolder extends TAbstractFile {
  children: TAbstractFile[] = [];
}

type Entry = { kind: 'file'; file: TFile; content: string } | { kind: 'folder'; folder: TFolder };

export class FakeVault {
  private entries = new Map<string, Entry>();
  private clock = 0;

  constructor(seed: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(seed)) {
      this.seedFile(path, content);
    }
  }

  // Creates (and links into its parent's `children`) any ancestor folder of
  // `path` that doesn't exist yet, recursively, and returns the immediate
  // parent — or undefined for a root-level path.
  private ensureParentChain(path: string): TFolder | undefined {
    const slash = path.lastIndexOf('/');
    if (slash === -1) return undefined;
    const parentPath = path.slice(0, slash);
    const existing = this.entries.get(parentPath);
    if (existing) {
      if (existing.kind !== 'folder') throw new Error(`FakeVault: "${parentPath}" is a file, not a folder`);
      return existing.folder;
    }
    const grandParent = this.ensureParentChain(parentPath);
    const folder = new TFolder(parentPath);
    this.entries.set(parentPath, { kind: 'folder', folder });
    grandParent?.children.push(folder);
    return folder;
  }

  seedFile(path: string, content: string): TFile {
    const parent = this.ensureParentChain(path);
    const file = new TFile(path);
    file.stat.mtime = ++this.clock;
    this.entries.set(path, { kind: 'file', file, content });
    parent?.children.push(file);
    return file;
  }

  getAbstractFileByPath(path: string): TAbstractFile | null {
    const entry = this.entries.get(path);
    if (!entry) return null;
    return entry.kind === 'file' ? entry.file : entry.folder;
  }

  getFolderByPath(path: string): TFolder | null {
    const entry = this.entries.get(path);
    return entry?.kind === 'folder' ? entry.folder : null;
  }

  // The fake has no root entry, so `includeRoot` has nothing to add.
  getAllFolders(_includeRoot?: boolean): TFolder[] {
    return [...this.entries.values()].flatMap(entry => (entry.kind === 'folder' ? [entry.folder] : []));
  }

  async read(file: TFile): Promise<string> {
    const entry = this.entries.get(file.path);
    if (entry?.kind !== 'file') throw new Error(`FakeVault: no file at "${file.path}"`);
    return entry.content;
  }

  async process(file: TFile, fn: (data: string) => string): Promise<string> {
    const entry = this.entries.get(file.path);
    if (entry?.kind !== 'file') throw new Error(`FakeVault: no file at "${file.path}"`);
    entry.content = fn(entry.content);
    entry.file.stat.mtime = ++this.clock;
    return entry.content;
  }

  async create(path: string, data: string): Promise<TFile> {
    if (this.entries.has(path)) throw new Error(`FakeVault: "${path}" already exists`);
    return this.seedFile(path, data);
  }

  async createFolder(path: string): Promise<TFolder> {
    if (this.entries.has(path)) throw new Error(`FakeVault: "${path}" already exists`);
    const parent = this.ensureParentChain(path);
    const folder = new TFolder(path);
    this.entries.set(path, { kind: 'folder', folder });
    parent?.children.push(folder);
    return folder;
  }

  async trash(entry: TAbstractFile): Promise<void> {
    this.entries.delete(entry.path);
  }

  // Test-only introspection, not part of the real Vault API.
  fileContent(path: string): string | undefined {
    const entry = this.entries.get(path);
    return entry?.kind === 'file' ? entry.content : undefined;
  }

  has(path: string): boolean {
    return this.entries.has(path);
  }
}

export class FakeFileManager {
  constructor(private readonly vault: FakeVault) {}
  async trashFile(file: TAbstractFile): Promise<void> {
    await this.vault.trash(file);
  }
}

// Real signature is `openLinkText(linktext, sourcePath, newLeaf?, openViewState?)`
// — a no-op here; tests that care spy on it.
export class FakeWorkspace {
  openLinkText(_linktext: string, _sourcePath: string, _newLeaf?: boolean): void {}
  getLeavesOfType(_type: string): WorkspaceLeaf[] {
    return [];
  }
  getRightLeaf(_split: boolean): WorkspaceLeaf | null {
    return null;
  }
  async revealLeaf(_leaf: WorkspaceLeaf): Promise<void> {}
  on(_name: string, _cb: (...args: unknown[]) => void): { name: string } {
    return { name: _name };
  }
  onLayoutReady(cb: () => void): void {
    cb();
  }
}

// Frontmatter as the real metadata cache exposes it: derived here from the
// note's own leading `---` block, enough for flat `key: value` scalars (the
// marker and similar) — not a YAML parser.
export class FakeMetadataCache {
  constructor(private readonly vault: FakeVault) {}
  getCache(path: string): { frontmatter?: Record<string, unknown> } | null {
    const content = this.vault.fileContent(path);
    if (content === undefined) return null;
    const lines = content.split('\n');
    if (lines[0] !== '---') return {};
    const end = lines.indexOf('---', 1);
    if (end === -1) return {};
    const frontmatter: Record<string, unknown> = {};
    for (const line of lines.slice(1, end)) {
      const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
      if (!match) continue;
      const raw = match[2].trim();
      frontmatter[match[1]] = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
    }
    return { frontmatter };
  }
  on(_name: string, _cb: (...args: unknown[]) => void): { name: string } {
    return { name: _name };
  }
}

export class App {
  vault: FakeVault;
  fileManager: FakeFileManager;
  workspace: FakeWorkspace;
  metadataCache: FakeMetadataCache;
  constructor(seed: Record<string, string> = {}) {
    this.vault = new FakeVault(seed);
    this.fileManager = new FakeFileManager(this.vault);
    this.workspace = new FakeWorkspace();
    this.metadataCache = new FakeMetadataCache(this.vault);
  }
}

// Stand-in for the editor-info state field a Live Preview extension reads the
// note's file from; never evaluated in tests (the gate is injected).
export const editorInfoField = {};

// Records what a context menu was given, so a test can read its items and
// invoke one. The real Menu's rendering is Obsidian's.
export class Menu {
  static last: Menu | undefined;
  items: { title: string; onClick: () => void }[] = [];
  shown = false;
  constructor() {
    Menu.last = this;
  }
  addItem(cb: (item: { setTitle(t: string): unknown; onClick(fn: () => void): unknown }) => void): this {
    const entry = { title: '', onClick: () => {} };
    const item = {
      setTitle(t: string) {
        entry.title = t;
        return item;
      },
      onClick(fn: () => void) {
        entry.onClick = fn;
        return item;
      },
    };
    cb(item);
    this.items.push(entry);
    return this;
  }
  showAtMouseEvent(_evt: MouseEvent): this {
    this.shown = true;
    return this;
  }
}

// --- Component / View hierarchy ---
// A real DOM element when jsdom is the test environment; a plain object
// otherwise, so importing this module never crashes a plain-'node' test
// file that doesn't happen to construct a View.
function fakeElement(): HTMLElement {
  return (globalThis as { document?: Document }).document?.createElement('div') ?? ({} as HTMLElement);
}

export class Component {
  private children: Component[] = [];
  addChild<T extends Component>(child: T): T {
    this.children.push(child);
    return child;
  }
  removeChild<T extends Component>(child: T): T {
    this.children = this.children.filter(c => c !== child);
    return child;
  }
  load(): void {
    this.onload();
  }
  onload(): void {}
  unload(): void {
    this.onunload();
    for (const child of this.children) child.unload();
  }
  onunload(): void {}
  register(_cb: () => void): void {}
  registerEvent(_ref: unknown): void {}
  registerDomEvent(_el: unknown, _type: string, _cb: (e: unknown) => void): void {}
  registerInterval(id: number): number {
    return id;
  }
}

export class WorkspaceLeaf {
  view: unknown;
  constructor(public app: App) {}
  async setViewState(_state: unknown): Promise<void> {}
}

export class View extends Component {
  app: App;
  containerEl: HTMLElement;
  leaf: WorkspaceLeaf;
  constructor(leaf: WorkspaceLeaf) {
    super();
    this.leaf = leaf;
    this.app = leaf.app;
    this.containerEl = fakeElement();
  }
  getViewType(): string {
    return 'fake-view';
  }
  getDisplayText(): string {
    return 'Fake view';
  }
  getIcon(): string {
    return 'dice';
  }
}

export class ItemView extends View {
  contentEl: HTMLElement;
  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
    this.contentEl = fakeElement();
    this.containerEl.append?.(this.contentEl);
  }
}

export class Notice {
  // Test-only record of every notice shown.
  static shown: string[] = [];
  message: string;
  constructor(message: string, _duration?: number) {
    this.message = message;
    Notice.shown.push(message);
  }
}

// Not exercised directly by this package's tests (which test the pure
// preview/apply functions a modal calls, not the modal's own rendering) —
// present so a file that defines a `class Foo extends Modal` loads without
// `extends undefined` throwing at class-definition time.
export class Modal extends Component {
  app: App;
  contentEl: HTMLElement;
  titleEl: HTMLElement;
  modalEl: HTMLElement;
  constructor(app: App) {
    super();
    this.app = app;
    this.contentEl = fakeElement();
    this.titleEl = fakeElement();
    this.modalEl = fakeElement();
  }
  open(): void {
    this.onOpen();
  }
  close(): void {
    this.onClose();
  }
  onOpen(): void {}
  onClose(): void {}
  setTitle(_title: string): this {
    return this;
  }
  setContent(_content: unknown): this {
    return this;
  }
}

// Only what a subclass needs to construct and be driven by a test; the real
// fuzzy matching and rendering are Obsidian's.
export abstract class FuzzySuggestModal<T> extends Modal {
  placeholder = '';
  setPlaceholder(placeholder: string): void {
    this.placeholder = placeholder;
  }
  abstract getItems(): T[];
  abstract getItemText(item: T): string;
  abstract onChooseItem(item: T, evt?: MouseEvent | KeyboardEvent): void;
}

// --- Plugin ---
export class Plugin extends Component {
  app: App;
  manifest: unknown;
  constructor(app: App, manifest: unknown = {}) {
    super();
    this.app = app;
    this.manifest = manifest;
  }
  async loadData(): Promise<unknown> {
    return undefined;
  }
  async saveData(_data: unknown): Promise<void> {}
  addCommand(_command: unknown): unknown {
    return _command;
  }
  addRibbonIcon(_icon: string, _title: string, _cb: (evt: MouseEvent) => void): HTMLElement {
    return fakeElement();
  }
  addSettingTab(_tab: unknown): void {}
  registerView(_type: string, _factory: (leaf: WorkspaceLeaf) => View): void {}
  registerEditorExtension(_extension: unknown): void {}
  registerMarkdownPostProcessor(_processor: unknown, _sortOrder?: number): unknown {
    return _processor;
  }
}

// --- Settings UI ---
// Bare-bones fluent builder, enough for a settings tab to construct and
// call `display()` without crashing. Deep settings-tab UI behavior is
// covered by manual testing (see the plan's verification checklist), not
// by these fakes.
class FakeValueComponent<T> {
  protected value: T;
  private changeHandler?: (value: T) => void;
  constructor(
    initial: T,
    protected readonly el: HTMLElement,
  ) {
    this.value = initial;
  }
  setValue(value: T): this {
    this.value = value;
    return this;
  }
  getValue(): T {
    return this.value;
  }
  onChange(cb: (value: T) => void): this {
    this.changeHandler = cb;
    return this;
  }
  setPlaceholder(_text: string): this {
    return this;
  }
  setDisabled(_disabled: boolean): this {
    return this;
  }
  // Test helper — not part of the real Obsidian API.
  trigger(value: T): void {
    this.value = value;
    this.changeHandler?.(value);
  }
}

class FakeButton {
  text = '';
  icon = '';
  tooltip = '';
  private clickHandler?: () => void;
  setButtonText(text: string): this {
    this.text = text;
    return this;
  }
  setIcon(icon: string): this {
    this.icon = icon;
    return this;
  }
  setTooltip(tooltip: string): this {
    this.tooltip = tooltip;
    return this;
  }
  onClick(cb: () => void): this {
    this.clickHandler = cb;
    return this;
  }
  // Test helper — not part of the real Obsidian API.
  click(): void {
    this.clickHandler?.();
  }
}

// Not exercised directly (its `display()` renders real settings-tab UI,
// covered by manual testing per the plan) — present so `class Foo extends
// PluginSettingTab` loads without `extends undefined` throwing.
export class PluginSettingTab {
  app: App;
  plugin: Plugin;
  containerEl: HTMLElement;
  constructor(app: App, plugin: Plugin) {
    this.app = app;
    this.plugin = plugin;
    this.containerEl = fakeElement();
  }
  display(): void {}
  hide(): void {}
}

export class Setting {
  // Test-only registry of every Setting built; tests clear it before display().
  static instances: Setting[] = [];
  settingEl: HTMLElement;
  nameEl: HTMLElement;
  descEl: HTMLElement;
  controlEl: HTMLElement;
  constructor(containerEl: HTMLElement) {
    Setting.instances.push(this);
    this.settingEl = fakeElement();
    this.nameEl = fakeElement();
    this.descEl = fakeElement();
    this.controlEl = fakeElement();
    this.settingEl.append?.(this.nameEl, this.descEl, this.controlEl);
    containerEl.append?.(this.settingEl);
  }
  setName(name: string): this {
    this.nameEl.textContent = name;
    return this;
  }
  setDesc(desc: string): this {
    this.descEl.textContent = desc;
    return this;
  }
  setHeading(): this {
    return this;
  }
  addText(cb: (component: FakeValueComponent<string>) => void): this {
    cb(new FakeValueComponent('', this.controlEl));
    return this;
  }
  addTextArea(cb: (component: FakeValueComponent<string>) => void): this {
    cb(new FakeValueComponent('', this.controlEl));
    return this;
  }
  addToggle(cb: (component: FakeValueComponent<boolean>) => void): this {
    cb(new FakeValueComponent(false, this.controlEl));
    return this;
  }
  // Test-only record of what was added, so a test can find and click it.
  buttons: FakeButton[] = [];
  addButton(cb: (component: FakeButton) => void): this {
    const button = new FakeButton();
    this.buttons.push(button);
    cb(button);
    return this;
  }
  addExtraButton(cb: (component: FakeButton) => void): this {
    return this.addButton(cb);
  }
}
