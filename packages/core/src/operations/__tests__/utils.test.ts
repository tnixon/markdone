import { localDateString } from '../utils';

describe('localDateString', () => {
  const previousTz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = 'Europe/Vienna';
  });
  afterAll(() => {
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  });

  test('is the local calendar date, which can differ from the UTC date', () => {
    const justAfterLocalMidnight = new Date('2026-10-17T22:30:00Z');
    expect(justAfterLocalMidnight.toISOString().slice(0, 10)).toBe('2026-10-17');
    expect(localDateString(justAfterLocalMidnight)).toBe('2026-10-18');
  });

  test('agrees with the UTC date away from local midnight', () => {
    expect(localDateString(new Date('2026-10-18T10:00:00Z'))).toBe('2026-10-18');
  });

  test('zero-pads month and day', () => {
    expect(localDateString(new Date('2026-03-05T12:00:00Z'))).toBe('2026-03-05');
  });
});
