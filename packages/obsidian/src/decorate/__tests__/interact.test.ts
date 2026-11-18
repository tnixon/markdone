// @vitest-environment jsdom
import type { MarkdownPostProcessorContext } from 'obsidian';
import { Menu } from '../../__tests__/fakeObsidian';
import { columnCounts, enhanceMarkdoneNote, formatCounts, type InteractionDeps } from '../interact';
import { parseProject } from '@markdone/core';

const NOTE = [
  '---',
  'markdone: 2',
  'layout: kanban',
  'columns: [Next, Later, Done]',
  '---',
  '',
  '## Next',
  '',
  '- [ ] Wireframe landing page ^wf1',
  '- [ ] Write copy ^wc1',
  '',
  '## Later',
  '',
  '## Done',
  '',
  '- [x] Kickoff ^ko1',
  '- [-] Dropped idea ^di1',
].join('\n');

function ctx(text: string, lineStart: number, lineEnd: number): MarkdownPostProcessorContext {
  return {
    docId: 'd',
    sourcePath: 'notes/board.md',
    frontmatter: null,
    getSectionInfo: () => ({ text, lineStart, lineEnd }),
    addChild: () => {},
  } as unknown as MarkdownPostProcessorContext;
}

function taskSection(items: { html: string; dataTask?: string }[]): HTMLElement {
  const root = document.createElement('div');
  const ul = document.createElement('ul');
  ul.className = 'contains-task-list';
  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'task-list-item';
    if (item.dataTask !== undefined) li.setAttribute('data-task', item.dataTask);
    li.innerHTML = `<input type="checkbox" class="task-list-item-checkbox">${item.html}`;
    ul.append(li);
  }
  root.append(ul);
  document.body.append(root);
  return root;
}

function makeDeps(overrides: Partial<InteractionDeps> = {}): InteractionDeps & { apply: ReturnType<typeof vi.fn>; notify: ReturnType<typeof vi.fn> } {
  return {
    defaultsFor: async () => undefined,
    apply: vi.fn(async () => ({ ok: true as const })),
    onConflict: vi.fn(),
    notify: vi.fn(),
    ...overrides,
  } as never;
}

function click(target: Element): MouseEvent {
  const evt = new MouseEvent('click', { bubbles: true, cancelable: true });
  target.dispatchEvent(evt);
  return evt;
}

describe('Reading-view checkbox click', () => {
  test('completes the task: prevents Obsidian’s own toggle and runs the operation on that source line', async () => {
    const deps = makeDeps();
    const el = taskSection([{ html: ' Wireframe landing page' }, { html: ' Write copy' }]);
    await enhanceMarkdoneNote(el, ctx(NOTE, 8, 9), deps);

    const evt = click(el.querySelectorAll('input')[1]);

    expect(evt.defaultPrevented).toBe(true);
    expect(deps.apply).toHaveBeenCalledWith('notes/board.md', 9, '- [ ] Write copy ^wc1', { kind: 'complete' });
  });

  test('clicking a done task uncompletes it', async () => {
    const deps = makeDeps();
    const el = taskSection([{ html: ' Kickoff', dataTask: 'x' }, { html: ' Dropped idea', dataTask: '-' }]);
    await enhanceMarkdoneNote(el, ctx(NOTE, 15, 16), deps);

    click(el.querySelectorAll('input')[0]);
    expect(deps.apply).toHaveBeenCalledWith('notes/board.md', 15, '- [x] Kickoff ^ko1', { kind: 'uncomplete' });
  });

  test('clicking a cancelled task does nothing', async () => {
    const deps = makeDeps();
    const el = taskSection([{ html: ' Kickoff', dataTask: 'x' }, { html: ' Dropped idea', dataTask: '-' }]);
    await enhanceMarkdoneNote(el, ctx(NOTE, 15, 16), deps);

    const evt = click(el.querySelectorAll('input')[1]);
    expect(evt.defaultPrevented).toBe(true); // Obsidian's own toggle is still suppressed
    expect(deps.apply).not.toHaveBeenCalled();
    expect(deps.notify).not.toHaveBeenCalled();
  });

  test('an item that does not match its source line writes nothing and tells the user', async () => {
    const deps = makeDeps();
    // The rendered text has nothing to do with line 9 (misaligned ordinal).
    const el = taskSection([{ html: ' Totally unrelated words' }]);
    await enhanceMarkdoneNote(el, ctx(NOTE, 9, 9), deps);

    click(el.querySelector('input')!);
    expect(deps.apply).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalledWith(expect.stringContaining('nothing was written'));
  });

  test('a refused write is reported; a conflict also reloads', async () => {
    const deps = makeDeps({ apply: vi.fn(async () => ({ ok: false as const, message: 'changed', conflict: true })) });
    const el = taskSection([{ html: ' Write copy' }]);
    await enhanceMarkdoneNote(el, ctx(NOTE, 9, 9), deps);

    click(el.querySelector('input')!);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(deps.onConflict).toHaveBeenCalledWith('notes/board.md');
    expect(deps.notify).toHaveBeenCalledWith(expect.stringContaining('reloaded'));
  });
});

describe('context menu', () => {
  test('lists every other column and runs a move', async () => {
    const deps = makeDeps();
    const el = taskSection([{ html: ' Wireframe landing page' }]);
    await enhanceMarkdoneNote(el, ctx(NOTE, 8, 8), deps);

    const evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    el.querySelector('li')!.dispatchEvent(evt);

    expect(evt.defaultPrevented).toBe(true);
    const menu = Menu.last!;
    expect(menu.shown).toBe(true);
    expect(menu.items.map(i => i.title)).toEqual(['Move to → Later', 'Move to → Done']);

    menu.items[0].onClick();
    expect(deps.apply).toHaveBeenCalledWith('notes/board.md', 8, '- [ ] Wireframe landing page ^wf1', {
      kind: 'move',
      columnName: 'Later',
    });
  });

  test('a note that is not a board gets no menu', async () => {
    const deps = makeDeps();
    const checklist = '---\nmarkdone: 2\n---\n- [ ] Only task ^a1\n';
    const el = taskSection([{ html: ' Only task' }]);
    await enhanceMarkdoneNote(el, ctx(checklist, 3, 3), deps);

    const evt = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    el.querySelector('li')!.dispatchEvent(evt);
    expect(evt.defaultPrevented).toBe(false);
  });
});

describe('column heading counts and drops', () => {
  test('a column heading gets a count badge computed from the whole file', async () => {
    const deps = makeDeps();
    const el = document.createElement('div');
    el.innerHTML = '<h2 data-heading="Done">Done</h2>';
    document.body.append(el);
    // The rendered section is only the heading; the counts still cover Done's tasks.
    await enhanceMarkdoneNote(el, ctx(NOTE, 13, 13), deps);

    expect(el.querySelector('.markdone-column-count')?.textContent).toBe('0 open · 1 done · 1 cancelled');
  });

  test('dropping a task on a column heading moves it', async () => {
    const deps = makeDeps();
    const heading = document.createElement('div');
    heading.innerHTML = '<h2 data-heading="Later">Later</h2>';
    document.body.append(heading);
    await enhanceMarkdoneNote(heading, ctx(NOTE, 11, 11), deps);

    const drop = new Event('drop', { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(drop, 'dataTransfer', {
      value: {
        types: ['application/x-markdone-task'],
        getData: () => JSON.stringify({ path: 'notes/board.md', line: 8, expectedLine: '- [ ] Wireframe landing page ^wf1' }),
      },
    });
    heading.querySelector('h2')!.dispatchEvent(drop);

    expect(deps.apply).toHaveBeenCalledWith('notes/board.md', 8, '- [ ] Wireframe landing page ^wf1', {
      kind: 'move',
      columnName: 'Later',
    });
  });

  test('columnCounts and formatCounts', () => {
    const { project } = parseProject(NOTE, { filenameFallback: 'board' });
    const counts = columnCounts(project);
    expect(formatCounts(counts.get('next')!)).toBe('2 open · 0 done');
    expect(formatCounts(counts.get('done')!)).toBe('0 open · 1 done · 1 cancelled');
  });
});

describe('checkboxes the plugin cannot map', () => {
  test('an item beyond the section’s task lines is blocked with a notice, not left to the native toggle', async () => {
    const deps = makeDeps();
    // Two rendered items, but the section's source holds only one task line.
    const el = taskSection([{ html: ' Write copy' }, { html: ' Phantom item' }]);
    await enhanceMarkdoneNote(el, ctx(NOTE, 9, 9), deps);

    const evt = click(el.querySelectorAll('input')[1]);
    expect(evt.defaultPrevented).toBe(true);
    expect(deps.apply).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalledWith(expect.stringContaining('nothing was written'));
  });

  test('an embed with no section info is blocked too', async () => {
    const deps = makeDeps();
    const el = taskSection([{ html: ' Write copy' }]);
    const embedCtx = { ...ctx(NOTE, 9, 9), getSectionInfo: () => null } as unknown as MarkdownPostProcessorContext;
    await enhanceMarkdoneNote(el, embedCtx, deps);

    const evt = click(el.querySelector('input')!);
    expect(evt.defaultPrevented).toBe(true);
    expect(deps.apply).not.toHaveBeenCalled();
    expect(deps.notify).toHaveBeenCalled();
  });
});

describe('column badges', () => {
  test('running twice on the same element does not duplicate the badge', async () => {
    const deps = makeDeps();
    const el = document.createElement('div');
    el.innerHTML = '<h2 data-heading="Done">Done</h2>';
    document.body.append(el);
    await enhanceMarkdoneNote(el, ctx(NOTE, 13, 13), deps);
    await enhanceMarkdoneNote(el, ctx(NOTE, 13, 13), deps);
    expect(el.querySelectorAll('.markdone-column-count')).toHaveLength(1);
  });
});

