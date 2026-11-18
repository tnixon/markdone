import { today, endOfWeek } from './dates';
import { useTimezone } from './testTimezone';

// Vienna is UTC+2 on 2026-10-18 (CEST ends on the 25th, and the 18th is a
// Sunday), so 22:30Z on the 17th is 00:30 local on the 18th.
useTimezone('Europe/Vienna');

function setClock(iso: string): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(iso));
}

afterEach(() => {
  vi.useRealTimers();
});

describe.each([
  ['just after local midnight', '2026-10-17T22:30:00Z'],
  ['midday', '2026-10-18T10:00:00Z'],
])('with the clock at Sunday 2026-10-18 %s (local)', (_label, iso) => {
  beforeEach(() => setClock(iso));

  test('today() is the local date', () => {
    expect(today()).toBe('2026-10-18');
  });

  test('endOfWeek() on a Sunday is that same Sunday', () => {
    expect(endOfWeek()).toBe('2026-10-18');
  });
});

test('endOfWeek() midweek is the coming Sunday', () => {
  setClock('2026-10-21T10:00:00Z'); // Wednesday
  expect(endOfWeek()).toBe('2026-10-25');
});
