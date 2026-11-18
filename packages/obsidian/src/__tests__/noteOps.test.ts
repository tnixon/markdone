import { App } from './fakeObsidian';
import { applyNoteOperation, planNoteOperation } from '../noteOps';
import { todayIso } from '../today';

const BOARD = [
  '---',
  'markdone: 2',
  'layout: kanban',
  'columns: [Next, Later, Done]',
  '---',
  '',
  '## Next',
  '',
  '- [ ] Wireframe ^wf1',
  '- [ ] No id yet',
  '',
  '## Later',
  '',
  '## Done',
].join('\n');

function lineOf(content: string, needle: string): number {
  return content.split('\n').findIndex(l => l.includes(needle));
}

describe('planNoteOperation', () => {
  test('completes a task by its ^id, writing only that task', () => {
    const line = lineOf(BOARD, 'Wireframe');
    const plan = planNoteOperation(BOARD, { line, expectedLine: BOARD.split('\n')[line], intent: { kind: 'complete' } }, 'board');
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    // Rule 3: completion (default on-complete = last column) moves it to Done.
    expect(plan.after).toContain('## Done\n- [x] Wireframe');
    expect(plan.after).not.toContain('## Next\n\n- [ ] Wireframe');
    expect(plan.after).toContain('^wf1');
  });

  test('assigns a ^id in the same write when the line has none', () => {
    const line = lineOf(BOARD, 'No id yet');
    const plan = planNoteOperation(BOARD, { line, expectedLine: BOARD.split('\n')[line], intent: { kind: 'complete' } }, 'board');
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.after).toMatch(/- \[x\] No id yet &\(\d{4}-\d{2}-\d{2}\) \^[A-Za-z0-9-]+/);
  });

  test('a line that is not what was rendered writes nothing', () => {
    const line = lineOf(BOARD, 'Wireframe');
    const plan = planNoteOperation(BOARD, { line, expectedLine: '- [ ] Something else', intent: { kind: 'complete' } }, 'board');
    expect(plan).toMatchObject({ ok: false });
  });

  test('a line that has stopped being a task writes nothing', () => {
    const edited = BOARD.replace('- [ ] Wireframe ^wf1', 'Wireframe is prose now');
    const line = lineOf(BOARD, 'Wireframe');
    const plan = planNoteOperation(edited, { line, expectedLine: BOARD.split('\n')[line], intent: { kind: 'complete' } }, 'board');
    expect(plan).toMatchObject({ ok: false });
  });

  test('moves between columns by name', () => {
    const line = lineOf(BOARD, 'Wireframe');
    const plan = planNoteOperation(
      BOARD,
      { line, expectedLine: BOARD.split('\n')[line], intent: { kind: 'move', columnName: 'Later' } },
      'board',
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.after).toContain('## Later\n- [ ] Wireframe');
  });

  test('moving into the completion column completes the task', () => {
    const line = lineOf(BOARD, 'Wireframe');
    const plan = planNoteOperation(
      BOARD,
      { line, expectedLine: BOARD.split('\n')[line], intent: { kind: 'move', columnName: 'Done' } },
      'board',
    );
    expect(plan.ok && plan.after).toContain('- [x] Wireframe');
  });

  test('uncompleting a done task in the completion column returns it to the first column', () => {
    const done = BOARD.replace('## Done', '## Done\n\n- [x] Shipped &(2026-04-01) ^sh1');
    const line = lineOf(done, 'Shipped');
    const plan = planNoteOperation(done, { line, expectedLine: done.split('\n')[line], intent: { kind: 'uncomplete' } }, 'board');
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.after).toMatch(/## Next\n+- \[ \] Shipped/);
  });

  test('a move in a note that is not a kanban board is refused', () => {
    const checklist = '---\nmarkdone: 2\n---\n- [ ] Only task ^a1\n';
    const plan = planNoteOperation(
      checklist,
      { line: 3, expectedLine: '- [ ] Only task ^a1', intent: { kind: 'move', columnName: 'Done' } },
      'list',
    );
    expect(plan).toMatchObject({ ok: false });
  });

  test('inherits the workspace default on-complete', () => {
    const line = lineOf(BOARD, 'Wireframe');
    const plan = planNoteOperation(
      BOARD,
      { line, expectedLine: BOARD.split('\n')[line], intent: { kind: 'complete' } },
      'board',
      { onComplete: 'Later' },
    );
    expect(plan.ok && plan.after).toContain('## Later\n- [x] Wireframe');
  });
});

describe('applyNoteOperation', () => {
  test('writes the planned change through the vault', async () => {
    const app = new App({ 'notes/board.md': BOARD });
    const line = lineOf(BOARD, 'Wireframe');
    const result = await applyNoteOperation(app as any, 'notes/board.md', {
      line,
      expectedLine: BOARD.split('\n')[line],
      intent: { kind: 'complete' },
    });
    expect(result).toEqual({ ok: true });
    expect(app.vault.fileContent('notes/board.md')).toContain('- [x] Wireframe');
  });

  test('a mismatch writes nothing', async () => {
    const app = new App({ 'notes/board.md': BOARD });
    const result = await applyNoteOperation(app as any, 'notes/board.md', {
      line: lineOf(BOARD, 'Wireframe'),
      expectedLine: '- [ ] Stale text',
      intent: { kind: 'complete' },
    });
    expect(result.ok).toBe(false);
    expect(app.vault.fileContent('notes/board.md')).toBe(BOARD);
  });
});

describe('planNoteOperation clock', () => {
  // Vienna is UTC+2 on 2026-10-18, so 22:30Z on the 17th is 00:30 local on the 18th.
  const previousTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'Europe/Vienna';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-17T22:30:00Z'));
  });
  afterAll(() => {
    vi.useRealTimers();
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  });

  test('the completion date written is the date the decorations treat as today', () => {
    const line = lineOf(BOARD, 'Wireframe');
    const plan = planNoteOperation(BOARD, { line, expectedLine: BOARD.split('\n')[line], intent: { kind: 'complete' } }, 'board');
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(todayIso()).toBe('2026-10-18');
    expect(plan.after).toContain(`&(${todayIso()})`);
  });
});
