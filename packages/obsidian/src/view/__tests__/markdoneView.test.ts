// @vitest-environment jsdom
import { App, WorkspaceLeaf } from '../../__tests__/fakeObsidian';
import { MarkdoneView } from '../markdoneView';
import { WorkspaceManager } from '../../workspaces';

async function makeView(app: App, folders: string[]) {
  const workspaceManager = new WorkspaceManager(app as any, () => {});
  await workspaceManager.configure(folders);
  const plugin = { workspaceManager } as any;
  const view = new MarkdoneView(new WorkspaceLeaf(app as any) as any, plugin);
  return view;
}

describe('MarkdoneView', () => {
  test('reports no workspaces configured', async () => {
    const app = new App();
    const view = await makeView(app, []);
    await view.onOpen();
    expect(view.contentEl.textContent).toContain('No Markdone workspace folders configured');
  });

  test('lists open tasks grouped by project by default', async () => {
    const app = new App({
      'workspace/inbox.md': '- [ ] Buy milk ^m1',
      'workspace/reading-list.md': ['---', 'markdone: 2', '---', '# Reading List', '', '- [ ] Deep Work ^r1'].join('\n'),
    });
    const view = await makeView(app, ['workspace']);
    await view.onOpen();

    const groupHeadings = Array.from(view.contentEl.querySelectorAll('h4')).map(h => h.textContent);
    expect(groupHeadings.sort()).toEqual(['Inbox (1)', 'Reading List (1)'].sort());
    expect(view.contentEl.textContent).toContain('Buy milk');
    expect(view.contentEl.textContent).toContain('Deep Work');
  });

  test('flags a kanban project with no open task under Next', async () => {
    const app = new App({
      'workspace/inbox.md': '',
      'workspace/website.md': ['---', 'markdone: 2', 'title: Website', 'layout: kanban', 'columns: [Next, Done]', '---', '', '## Next', '', '## Done'].join('\n'),
    });
    const view = await makeView(app, ['workspace']);
    await view.onOpen();

    expect(view.contentEl.querySelector('.markdone-stalled-notice')?.textContent).toContain('Website');
  });

  test('changing the group-by select re-renders with a different grouping', async () => {
    const app = new App({ 'workspace/inbox.md': '- [ ] Task @home ^m1' });
    const view = await makeView(app, ['workspace']);
    await view.onOpen();

    const select = view.contentEl.querySelector<HTMLSelectElement>('.markdone-group-select')!;
    select.value = 'context';
    select.dispatchEvent(new Event('change'));

    expect(view.contentEl.querySelector('h4')?.textContent).toBe('home (1)');
  });

  test('clicking a task checkbox completes it and re-renders without that open task', async () => {
    const app = new App({ 'workspace/inbox.md': '- [ ] Buy milk ^m1' });
    const view = await makeView(app, ['workspace']);
    await view.onOpen();

    const checkbox = view.contentEl.querySelector<HTMLInputElement>('.markdone-task-checkbox')!;
    checkbox.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise(resolve => setTimeout(resolve, 0)); // let the async completeTask settle

    expect(app.vault.fileContent('workspace/inbox.md')).toContain('[x] Buy milk');
    expect(view.contentEl.textContent).toContain('No open tasks');
  });

  test('clicking a task opens it via workspace.openLinkText with its file and block id', async () => {
    const app = new App({ 'workspace/inbox.md': '- [ ] Buy milk ^m1' });
    const openSpy = vi.spyOn(app.workspace, 'openLinkText');
    const view = await makeView(app, ['workspace']);
    await view.onOpen();

    view.contentEl.querySelector<HTMLElement>('.markdone-task-text')!.click();

    expect(openSpy).toHaveBeenCalledWith('workspace/inbox.md#^m1', '', false);
  });
});
