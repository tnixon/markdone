import { todayIso } from '../today';

// Vienna is UTC+2 on 2026-10-18 (CEST ends on the 25th), so 22:30Z on the 17th
// is 00:30 local on the 18th — when a UTC-derived date is still the 17th.
process.env.TZ = 'Europe/Vienna';

describe('todayIso', () => {
  test('is the local calendar date just after local midnight, not the UTC date', () => {
    expect(todayIso(new Date('2026-10-17T22:30:00Z'))).toBe('2026-10-18');
  });

  test('is the same local date at midday', () => {
    expect(todayIso(new Date('2026-10-18T10:00:00Z'))).toBe('2026-10-18');
  });

  test('reads the current time when no date is given', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-17T22:30:00Z'));
      expect(todayIso()).toBe('2026-10-18');
    } finally {
      vi.useRealTimers();
    }
  });
});
