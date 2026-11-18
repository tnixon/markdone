import { parseNaturalDate } from '../DueDatePicker';
import { useTimezone } from '../../testTimezone';

// Vienna is UTC+2 on 2026-10-18 (CEST ends on the 25th, and the 18th is a
// Sunday), so 22:30Z on the 17th is 00:30 local on the 18th.
useTimezone('Europe/Vienna');

afterEach(() => {
  vi.useRealTimers();
});

describe.each([
  ['just after local midnight', '2026-10-17T22:30:00Z'],
  ['midday', '2026-10-18T10:00:00Z'],
])('parseNaturalDate with the clock at Sunday 2026-10-18 %s (local)', (_label, iso) => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
  });

  test.each([
    ['today', '2026-10-18'],
    ['tomorrow', '2026-10-19'],
    ['yesterday', '2026-10-17'],
    ['next friday', '2026-10-23'],
    ['in 3 days', '2026-10-21'],
    ['in 2 weeks', '2026-11-01'],
  ])('%s is %s', (input, expected) => {
    expect(parseNaturalDate(input)).toBe(expected);
  });

  test('an explicit date and unparseable text are unchanged', () => {
    expect(parseNaturalDate('2026-03-05')).toBe('2026-03-05');
    expect(parseNaturalDate('whenever')).toBeNull();
  });
});
