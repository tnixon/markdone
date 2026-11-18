import { parse, type AppState } from '@markdone/core';
import { assembleContext } from './context';
import { useTimezone } from '../testTimezone';

// Vienna is UTC+2 on 2026-10-18, so 22:30Z on the 17th is 00:30 local on the 18th.
useTimezone('Europe/Vienna');

function workspace(id: string, markdown: string): AppState['workspaces'][number] {
  return { config: { id, name: id, filePath: `/${id}.md` }, todoFile: parse(markdown).file };
}

// The out-of-scope workspace is the one summarised (with its overdue count)
// rather than serialised in full.
const state: AppState = {
  activeScope: 'a',
  workspaces: [workspace('a', '# Inbox\n\n- [ ] In scope\n'), workspace('b', '# Inbox\n\n- [ ] Late !2026-10-17\n- [ ] Later !2026-10-25\n')],
};

afterEach(() => {
  vi.useRealTimers();
});

describe.each([
  ['just after local midnight', '2026-10-17T22:30:00Z'],
  ['midday', '2026-10-18T10:00:00Z'],
])('a summarised workspace with the clock at 2026-10-18 %s (local)', (_label, iso) => {
  test('counts as overdue what was due before the local date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
    expect(assembleContext(state, 'current', 'a')).toContain('[2 tasks, 1 overdue]');
  });
});
