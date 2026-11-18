import { headingOfLine } from '../taskState';

describe('headingOfLine', () => {
  test('is the nearest preceding ## heading', () => {
    const lines = ['## Next', '- [ ] a', '## Done', '- [x] b'];
    expect(headingOfLine(lines, 1)).toBe('Next');
    expect(headingOfLine(lines, 3)).toBe('Done');
  });

  test('is undefined above the first heading', () => {
    expect(headingOfLine(['- [ ] a', '## Next'], 0)).toBeUndefined();
  });

  test('ignores a ## line inside a fenced code block', () => {
    const lines = ['## Next', '```', '## Not a column', '```', '- [ ] a'];
    expect(headingOfLine(lines, 4)).toBe('Next');
  });

  test('a tilde fence is a fence too, and fences of the other kind do not close it', () => {
    const lines = ['## Next', '~~~', '```', '## Fake', '~~~', '- [ ] a'];
    expect(headingOfLine(lines, 5)).toBe('Next');
  });
});
