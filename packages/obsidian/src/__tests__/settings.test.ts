// @vitest-environment jsdom
import { App, Modal, Notice, Setting } from './fakeObsidian';
import { MarkdoneSettingTab } from '../settings';

// `display()` builds its Settings internally; the fake `Setting` registers
// each one, so keep those that got a button (the folder rows' remove buttons
// and the final "Add folder…" row).
function displayAndGetButtonSettings(tab: MarkdoneSettingTab): Setting[] {
  Setting.instances = [];
  tab.display();
  return Setting.instances.filter(setting => setting.buttons.length > 0);
}

function displayAndGetAddRow(tab: MarkdoneSettingTab): Setting {
  const rows = displayAndGetButtonSettings(tab);
  return rows[rows.length - 1];
}

function makeTab(folders: string[], vaultSeed: Record<string, string>) {
  const app = new App(vaultSeed);
  const plugin = {
    settings: { workspaceFolders: folders, defaultOwner: '', chipTypes: {} },
    setWorkspaceFolders: vi.fn(async (_folders: string[]) => {}),
  };
  const tab = new MarkdoneSettingTab(app as any, plugin as any);
  // `empty()` and `createEl()` are Obsidian DOM extensions, absent from jsdom.
  const el = tab.containerEl as any;
  el.empty = () => el.replaceChildren();
  el.createEl = () => document.createElement('p');
  return { app, tab, plugin };
}

const flushPromises = () => new Promise(resolve => setTimeout(resolve, 0));

describe('MarkdoneSettingTab workspace folders', () => {
  test('a configured folder that is not in the vault is flagged', () => {
    const { tab } = makeTab(['gone', 'here'], { 'here/inbox.md': '' });

    const [goneRow, hereRow] = displayAndGetButtonSettings(tab);

    expect(goneRow.descEl.textContent).toContain('not found');
    expect(hereRow.descEl.textContent).toBe('');
  });

  test('remove drops just that folder, without touching the vault', () => {
    const { tab, plugin } = makeTab(['a', 'b'], { 'a/inbox.md': '', 'b/inbox.md': '' });

    const [aRow] = displayAndGetButtonSettings(tab);
    aRow.buttons[0].click();

    expect(plugin.setWorkspaceFolders).toHaveBeenCalledWith(['b']);
  });

  test('remove builds on the latest folder list, not the one from render time', () => {
    const { tab, plugin } = makeTab(['a', 'b'], { 'a/inbox.md': '', 'b/inbox.md': '' });

    const [, bRow] = displayAndGetButtonSettings(tab);
    plugin.settings.workspaceFolders = ['b', 'c'];
    bRow.buttons[0].click();

    expect(plugin.setWorkspaceFolders).toHaveBeenCalledWith(['c']);
  });

  test('add appends the picked folder and announces it after saving', async () => {
    const { app, tab, plugin } = makeTab(['a'], { 'a/inbox.md': '', 'b/x.md': '' });
    const open = vi.spyOn(Modal.prototype, 'open').mockImplementation(function (this: any) {
      this.onChooseItem(app.vault.getFolderByPath('b'));
    });
    Notice.shown = [];
    try {
      const addRow = displayAndGetAddRow(tab);
      addRow.buttons[0].click();
      await flushPromises();
    } finally {
      open.mockRestore();
    }

    expect(plugin.setWorkspaceFolders).toHaveBeenCalledWith(['a', 'b']);
    expect(Notice.shown).toEqual(['Markdone: initialized workspace in b']);
  });

  test('add shows no success notice when the save fails', async () => {
    const { app, tab, plugin } = makeTab([], { 'b/x.md': '' });
    plugin.setWorkspaceFolders.mockRejectedValue(new Error('disk full'));
    const open = vi.spyOn(Modal.prototype, 'open').mockImplementation(function (this: any) {
      this.onChooseItem(app.vault.getFolderByPath('b'));
    });
    Notice.shown = [];
    try {
      displayAndGetAddRow(tab).buttons[0].click();
      await flushPromises();
    } finally {
      open.mockRestore();
    }

    expect(Notice.shown).toHaveLength(1);
    expect(Notice.shown[0]).toContain('could not update');
  });

  test('a failed save shows a notice instead of an unhandled rejection', async () => {
    const { tab, plugin } = makeTab(['a'], { 'a/inbox.md': '' });
    plugin.setWorkspaceFolders.mockRejectedValue(new Error('disk full'));
    const [aRow] = displayAndGetButtonSettings(tab);
    const display = vi.spyOn(tab, 'display');
    Notice.shown = [];
    aRow.buttons[0].click();
    await flushPromises();

    expect(display).not.toHaveBeenCalled();
    expect(Notice.shown[0]).toContain('could not update');
  });
});
