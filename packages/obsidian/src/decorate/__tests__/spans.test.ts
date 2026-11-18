import { chipsForLine, cueForTaskLine, CHIP_KINDS, type ChipSettings } from '../spans';

const ALL_ENABLED: ChipSettings = Object.fromEntries(CHIP_KINDS.map(k => [k, true])) as ChipSettings;

describe('chipsForLine', () => {
  test('chips every enabled token kind on a fully-loaded line', () => {
    const body = 'Ship it !2026-04-20 >2026-04-10 @computer $9 %8 ~3days &(2026-04-18)';
    const chips = chipsForLine(body, ALL_ENABLED);
    expect(chips.map(c => c.kind).sort()).toEqual(
      ['actual', 'complexity', 'context', 'defer', 'due', 'effort', 'value'].sort(),
    );
  });

  test('chips #owner/ and #waiting/ but not a plain #tag or another nested tag', () => {
    const body = 'Task #owner/alice #waiting/bob #urgent #sprint/4';
    const chips = chipsForLine(body, ALL_ENABLED);
    expect(chips.map(c => c.kind).sort()).toEqual(['owner', 'waiting']);
  });

  test('never chips ^id — outside the MVP\'s chip list', () => {
    const chips = chipsForLine('Task ^my-id', ALL_ENABLED);
    expect(chips).toEqual([]);
  });

  test('never chips a malformed token — it stays plain description text', () => {
    const chips = chipsForLine('Task !not-a-date', ALL_ENABLED);
    expect(chips).toEqual([]);
  });

  test('a disabled chip kind in settings is not chipped', () => {
    const settings: ChipSettings = { ...ALL_ENABLED, context: false };
    const chips = chipsForLine('Task @home $5', settings);
    expect(chips.map(c => c.kind)).toEqual(['value']);
  });

  test('cssClass names both the generic and kind-specific class', () => {
    const [chip] = chipsForLine('Task @home', ALL_ENABLED);
    expect(chip.cssClass).toBe('markdone-token markdone-token--context');
  });

  test('a token inside a wikilink is not chipped, matching the tokenizer\'s protected spans', () => {
    const chips = chipsForLine('See [[Notes $5]] @home', ALL_ENABLED);
    expect(chips.map(c => c.kind)).toEqual(['context']);
  });
});

describe('cueForTaskLine', () => {
  test('overdue when the due date has already passed', () => {
    expect(cueForTaskLine('- [ ] Task !2026-01-01', '2026-04-01')).toBe('overdue');
  });

  test('negative-slack when the deadline has not passed but there is not enough time left', () => {
    expect(cueForTaskLine('- [ ] Task !2026-04-03 ~5days', '2026-04-01')).toBe('negative-slack');
  });

  test('undefined when there is ample slack', () => {
    expect(cueForTaskLine('- [ ] Task !2026-05-01 ~1days', '2026-04-01')).toBeUndefined();
  });

  test('undefined with no due date at all', () => {
    expect(cueForTaskLine('- [ ] Task @home', '2026-04-01')).toBeUndefined();
  });

  test('undefined for a completed task, even with a past due date', () => {
    expect(cueForTaskLine('- [x] Task !2026-01-01', '2026-04-01')).toBeUndefined();
  });

  test('undefined for a non-task line', () => {
    expect(cueForTaskLine('Just a paragraph !2026-01-01', '2026-04-01')).toBeUndefined();
  });
});
