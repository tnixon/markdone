// @vitest-environment jsdom
import type { MarkdownPostProcessorContext, MarkdownSectionInformation } from 'obsidian';
import { decorateReadingView } from '../readingView';
import { CHIP_KINDS, type ChipSettings } from '../spans';

const ALL_ENABLED: ChipSettings = Object.fromEntries(CHIP_KINDS.map(k => [k, true])) as ChipSettings;

function fakeContext(sourceText: string, lineStart = 0): MarkdownPostProcessorContext {
  const info: MarkdownSectionInformation = { text: sourceText, lineStart, lineEnd: sourceText.split('\n').length - 1 + lineStart };
  return {
    docId: 'test',
    sourcePath: 'test.md',
    frontmatter: null,
    getSectionInfo: () => info,
    addChild: () => {},
  } as unknown as MarkdownPostProcessorContext;
}

// Mirrors what Obsidian's own reading-view renderer produces for a task
// list: the checkbox input, then plain text, with every `#word` already
// turned into `<a class="tag">` regardless of whether it's a native tag or
// one of Markdone's reserved nested tags.
function renderTaskListItem(bodyHtml: string): HTMLElement {
  const li = document.createElement('li');
  li.className = 'task-list-item';
  li.innerHTML = `<input type="checkbox" class="task-list-item-checkbox">${bodyHtml}`;
  const ul = document.createElement('ul');
  ul.className = 'contains-task-list';
  ul.appendChild(li);
  const container = document.createElement('div');
  container.appendChild(ul);
  return container;
}

describe('decorateReadingView', () => {
  test('chips plain-text tokens and adds a class to the owner tag anchor', () => {
    const source = '- [ ] Wireframe landing page !2026-04-05 @computer $9 #owner/bob';
    const el = renderTaskListItem(
      ' Wireframe landing page !2026-04-05 @computer $9 <a href="#owner/bob" class="tag">#owner/bob</a>',
    );

    decorateReadingView(el, fakeContext(source), ALL_ENABLED, '2026-04-01');

    const dueChip = el.querySelector('.markdone-token--due');
    const contextChip = el.querySelector('.markdone-token--context');
    const valueChip = el.querySelector('.markdone-token--value');
    const ownerTag = el.querySelector('a.tag');

    expect(dueChip?.textContent).toBe('!2026-04-05');
    expect(contextChip?.textContent).toBe('@computer');
    expect(valueChip?.textContent).toBe('$9');
    expect(ownerTag?.classList.contains('markdone-token')).toBe(true);
    expect(ownerTag?.classList.contains('markdone-token--owner')).toBe(true);
    // The tag's own text and click behavior (its href) are untouched.
    expect(ownerTag?.textContent).toBe('#owner/bob');
  });

  test('a plain #tag anchor is left alone — no Markdone class added', () => {
    const source = '- [ ] Task #urgent';
    const el = renderTaskListItem(' Task <a href="#urgent" class="tag">#urgent</a>');

    decorateReadingView(el, fakeContext(source), ALL_ENABLED, '2026-04-01');

    const tag = el.querySelector('a.tag')!;
    expect(tag.classList.contains('markdone-token')).toBe(false);
  });

  test('a token inside a code span is not chipped', () => {
    const source = '- [ ] Fix `$PATH` handling $5';
    const el = renderTaskListItem(' Fix <code>$PATH</code> handling $5');

    decorateReadingView(el, fakeContext(source), ALL_ENABLED, '2026-04-01');

    expect(el.querySelector('code')?.textContent).toBe('$PATH');
    expect(el.querySelector('.markdone-token--value')?.textContent).toBe('$5');
  });

  test('a disabled chip kind in settings is not chipped in reading view either', () => {
    const source = '- [ ] Task @home $5';
    const el = renderTaskListItem(' Task @home $5');
    const settings: ChipSettings = { ...ALL_ENABLED, context: false };

    decorateReadingView(el, fakeContext(source), settings, '2026-04-01');

    expect(el.querySelector('.markdone-token--context')).toBeNull();
    expect(el.querySelector('.markdone-token--value')).not.toBeNull();
  });

  test('applies the overdue line class from the correlated source line', () => {
    const source = ['- [ ] Overdue task !2026-01-01', '- [ ] Fine task !2026-06-01'].join('\n');
    const container = document.createElement('div');
    const ul = document.createElement('ul');
    ul.className = 'contains-task-list';
    for (const text of ['Overdue task !2026-01-01', 'Fine task !2026-06-01']) {
      const li = document.createElement('li');
      li.className = 'task-list-item';
      li.innerHTML = `<input type="checkbox" class="task-list-item-checkbox"> ${text}`;
      ul.appendChild(li);
    }
    container.appendChild(ul);

    decorateReadingView(container, fakeContext(source), ALL_ENABLED, '2026-04-01');

    const items = container.querySelectorAll('li.task-list-item');
    expect(items[0].classList.contains('markdone-line--overdue')).toBe(true);
    expect(items[1].classList.contains('markdone-line--overdue')).toBe(false);
  });

  test('does nothing when there are no task list items', () => {
    const container = document.createElement('div');
    container.innerHTML = '<p>Just a paragraph</p>';
    expect(() => decorateReadingView(container, fakeContext('Just a paragraph'), ALL_ENABLED, '2026-04-01')).not.toThrow();
  });
});

describe('decorateReadingView gate and state hooks', () => {
  test('a note that fails the marker gate is left entirely alone', () => {
    const el = renderTaskListItem(' Wireframe !2026-04-05');
    decorateReadingView(el, fakeContext('- [ ] Wireframe !2026-04-05'), ALL_ENABLED, '2026-04-01', () => false);
    expect(el.querySelector('.markdone-token')).toBeNull();
    expect(el.querySelector('li')!.dataset.markdoneStatus).toBeUndefined();
  });

  test('a marked note gets state data attributes and classes', () => {
    const source = [
      '## Next',
      '- [x] Shipped',
      '- [-] Dropped',
      '- [ ] Chase Bob #waiting/bob @phone',
      '- [ ] Later thing >2026-12-01',
    ].join('\n');
    const el = document.createElement('div');
    const ul = document.createElement('ul');
    for (const text of ['Shipped', 'Dropped', 'Chase Bob', 'Later thing']) {
      const li = document.createElement('li');
      li.className = 'task-list-item';
      li.textContent = text;
      ul.append(li);
    }
    el.append(ul);

    decorateReadingView(el, fakeContext(source), ALL_ENABLED, '2026-04-01', () => true);

    const [done, cancelled, waiting, deferred] = Array.from(el.querySelectorAll<HTMLElement>('li'));
    expect(done.dataset.markdoneStatus).toBe('done');
    expect(done.classList.contains('markdone-line--done')).toBe(true);
    expect(done.dataset.markdoneColumn).toBe('Next');
    expect(cancelled.dataset.markdoneStatus).toBe('cancelled');
    expect(cancelled.classList.contains('markdone-line--cancelled')).toBe(true);
    expect(waiting.dataset.markdoneWaiting).toBe('true');
    expect(waiting.dataset.markdoneContext).toBe('phone');
    expect(waiting.classList.contains('markdone-line--waiting')).toBe(true);
    expect(deferred.dataset.markdoneDeferred).toBe('true');
    expect(deferred.classList.contains('markdone-line--deferred')).toBe(true);
  });
});

