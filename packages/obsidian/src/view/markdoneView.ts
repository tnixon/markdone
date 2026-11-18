import { ItemView, Notice, type WorkspaceLeaf } from 'obsidian';
import { buildQueryState, getOperation, runOperation, type TaskWithLocation } from '@markdone/core';
import type MarkdonePlugin from '../main';
import { previewAndApply } from '../write';
import { groupTasks, projectsStalledOnNext, renderTaskList, type GroupBy, type TaskRow } from './render';

export const VIEW_TYPE_MARKDONE = 'markdone-view';

export class MarkdoneView extends ItemView {
  private groupBy: GroupBy = 'project';

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: MarkdonePlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_MARKDONE;
  }

  getDisplayText(): string {
    return 'Markdone';
  }

  getIcon(): string {
    return 'checkmark';
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  async onClose(): Promise<void> {
    // Nothing to clean up — every registration this view makes goes through
    // Plugin.register*/addChild elsewhere, which the plugin's own onunload
    // already tears down.
  }

  // Called by the plugin after a workspace reload, so the view reflects the
  // latest file content without the user having to close and reopen it.
  refresh(): void {
    this.render();
  }

  private render(): void {
    const container = this.contentEl;
    const doc = container.ownerDocument;
    container.replaceChildren();
    container.classList.add('markdone-view');
    container.append(this.renderHeader());

    const workspaces = this.plugin.workspaceManager.list();
    if (workspaces.length === 0) {
      const empty = doc.createElement('p');
      empty.textContent = 'No Markdone workspace folders configured. Add one in Settings → Markdone.';
      container.append(empty);
      return;
    }

    const state = buildQueryState(workspaces.map(w => ({ id: w.id, path: w.folder, isDirectory: true, handle: w.handle })));

    const stalled = projectsStalledOnNext(state);
    if (stalled.length > 0) {
      const notice = doc.createElement('p');
      notice.className = 'markdone-stalled-notice';
      notice.textContent = `Stalled — no open task under Next: ${stalled.join(', ')}`;
      container.append(notice);
    }

    const listContainer = doc.createElement('div');
    listContainer.className = 'markdone-task-list';
    container.append(listContainer);

    // The view is an actionable-tasks list, not a full history — a done or
    // cancelled task drops off once its checkbox click's mutation lands.
    const listResult = runOperation('listTasks', state, { checkboxState: 'open' });
    if (!listResult.ok) {
      listContainer.textContent = `Error: ${listResult.error.message}`;
      return;
    }

    const tasks = listResult.value as TaskWithLocation[];
    const groups = groupTasks(state, tasks, this.groupBy);
    renderTaskList(listContainer, groups, {
      onToggle: row => void this.completeTask(row),
      onOpenTask: row => this.openTask(row),
    });
  }

  private renderHeader(): HTMLElement {
    const doc = this.contentEl.ownerDocument;
    const header = doc.createElement('div');
    header.className = 'markdone-view-header';

    const label = doc.createElement('label');
    label.textContent = 'Group by ';
    const select = doc.createElement('select');
    select.className = 'markdone-group-select';
    for (const value of ['project', 'context', 'owner'] as GroupBy[]) {
      const option = doc.createElement('option');
      option.value = value;
      option.textContent = value;
      option.selected = value === this.groupBy;
      select.append(option);
    }
    select.addEventListener('change', () => {
      this.groupBy = select.value as GroupBy;
      this.render();
    });
    label.append(select);
    header.append(label);
    return header;
  }

  private async completeTask(row: TaskRow): Promise<void> {
    const ws = this.plugin.workspaceManager.find(row.workspaceId);
    const blockId = row.item.task.blockId;
    if (!ws || !blockId) return; // reconcileBlockIds guarantees one by the time the view renders

    const completeTask = getOperation('completeTask')!;
    const result = await previewAndApply(this.app, ws.handle, completeTask, {
      location: { workspaceId: row.workspaceId, taskId: blockId },
    });
    if (!result.ok) {
      new Notice(`Markdone: ${result.message}`);
      return;
    }
    this.render();
  }

  private openTask(row: TaskRow): void {
    const ws = this.plugin.workspaceManager.find(row.workspaceId);
    const blockId = row.item.task.blockId;
    if (!ws || !blockId) return;

    const project = ws.handle.listProjects()[row.item.location.projectIndex];
    const filePath = project ? ws.projectFiles.get(project) : undefined;
    if (!filePath) {
      new Notice("Markdone: couldn't find the file for this task");
      return;
    }
    this.app.workspace.openLinkText(`${filePath}#^${blockId}`, '', false);
  }
}
