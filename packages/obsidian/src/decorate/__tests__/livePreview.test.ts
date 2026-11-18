import { computeLineDecorations } from '../livePreview';
import { CHIP_KINDS, type ChipSettings } from '../spans';

const ALL_ENABLED: ChipSettings = Object.fromEntries(CHIP_KINDS.map(k => [k, true])) as ChipSettings;

describe('computeLineDecorations', () => {
  test('a non-task line produces no decorations', () => {
    expect(computeLineDecorations('Just a paragraph @home', 100, ALL_ENABLED, '2026-04-01')).toEqual([]);
  });

  test('chip spans are offset by the line start and the checkbox prefix width', () => {
    const line = '- [ ] Task @home';
    const spans = computeLineDecorations(line, 100, ALL_ENABLED, '2026-04-01');
    const chip = spans.find(s => s.type === 'mark')!;
    // "- [ ] " is 6 chars; "@home" starts right after "Task ".
    const expectedStart = 100 + line.indexOf('@home');
    expect(chip.from).toBe(expectedStart);
    expect(chip.to).toBe(expectedStart + '@home'.length);
    expect(line.slice(chip.from - 100, chip.to - 100)).toBe('@home');
  });

  test('an indented (subtask) line offsets correctly too', () => {
    const line = '  - [ ] Subtask @home';
    const spans = computeLineDecorations(line, 50, ALL_ENABLED, '2026-04-01');
    const chip = spans.find(s => s.type === 'mark')!;
    expect(line.slice(chip.from - 50, chip.to - 50)).toBe('@home');
  });

  test('a line decoration is included, and sorted before any chip on the same line', () => {
    const line = '- [ ] Overdue task !2026-01-01';
    const spans = computeLineDecorations(line, 200, ALL_ENABLED, '2026-04-01');
    expect(spans[0]).toMatchObject({ from: 200, to: 200, type: 'line', cssClass: 'markdone-line markdone-line--overdue' });
    // Every subsequent span (the chip) starts at or after the line decoration.
    expect(spans.slice(1).every(s => s.from >= spans[0].from)).toBe(true);
  });

  test('no line decoration for a task with ample slack', () => {
    const line = '- [ ] Fine task !2026-06-01 ~1days';
    const spans = computeLineDecorations(line, 0, ALL_ENABLED, '2026-04-01');
    expect(spans.some(s => s.type === 'line')).toBe(false);
  });

  test('disabling a chip kind in settings removes it, leaving others', () => {
    const settings: ChipSettings = { ...ALL_ENABLED, context: false };
    const line = '- [ ] Task @home $5';
    const spans = computeLineDecorations(line, 0, settings, '2026-04-01');
    expect(spans.filter(s => s.type === 'mark')).toHaveLength(1);
    expect(spans[0].cssClass).toContain('value');
  });
});
