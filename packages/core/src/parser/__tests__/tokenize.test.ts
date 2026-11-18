import { locateTaskLineTokens, tokenizeTaskLine, type TaskLineToken } from '../tokenize';

// `locateTaskLineTokens` is the span-producing half of the same scan
// `tokenizeTaskLine` folds into a structured result (see tokenize.ts's
// `scanRawTokenMatches`). These tests check the two agree: every span
// `locateTaskLineTokens` reports as `valid` corresponds to a value
// `tokenizeTaskLine` actually extracted, and the span's substring is
// exactly the token text an editor would want to highlight.
describe('locateTaskLineTokens', () => {
  function spanText(line: string, token: TaskLineToken): string {
    return line.slice(token.start, token.end);
  }

  test('locates one span per token, each substring matching the source exactly', () => {
    const line = 'Ship it !2026-04-20 @computer $9 %8 ~3days #backend ^abc123';
    const tokens = locateTaskLineTokens(line);
    const byKind = Object.fromEntries(tokens.map(t => [t.kind, t]));

    expect(spanText(line, byKind.due)).toBe('!2026-04-20');
    expect(spanText(line, byKind.context)).toBe('@computer');
    expect(spanText(line, byKind.value)).toBe('$9');
    expect(spanText(line, byKind.complexity)).toBe('%8');
    expect(spanText(line, byKind.effort)).toBe('~3days');
    expect(spanText(line, byKind.tag)).toBe('#backend');
    expect(spanText(line, byKind.blockId)).toBe('^abc123');
    expect(tokens.every(t => t.valid)).toBe(true);
    expect(tokens.every(t => !t.deprecated)).toBe(true);
  });

  test('a nested tag span carries its key', () => {
    const line = 'Blocked #after/ship-v2 #owner/bob';
    const tokens = locateTaskLineTokens(line);
    const after = tokens.find(t => t.kind === 'tag' && spanText(line, t) === '#after/ship-v2');
    const owner = tokens.find(t => t.kind === 'tag' && spanText(line, t) === '#owner/bob');
    expect(after?.key).toBe('after');
    expect(owner?.key).toBe('owner');
  });

  test('a plain label tag has no key', () => {
    const line = 'Do it #urgent';
    const [token] = locateTaskLineTokens(line);
    expect(token.kind).toBe('tag');
    expect(token.key).toBeUndefined();
  });

  test('deprecated syntax is located and flagged, not silently skipped', () => {
    const line = 'Old style *2hrs #sprint(4)';
    const tokens = locateTaskLineTokens(line);
    const effort = tokens.find(t => t.kind === 'effort');
    const tag = tokens.find(t => t.kind === 'tag');
    expect(effort).toMatchObject({ valid: true, deprecated: true });
    expect(spanText(line, effort!)).toBe('*2hrs');
    expect(tag).toMatchObject({ valid: true, deprecated: true, key: 'sprint' });
    expect(spanText(line, tag!)).toBe('#sprint(4)');
  });

  test('@waiting is located as a deprecated context, not a tag', () => {
    const line = 'Follow up @waiting';
    const [token] = locateTaskLineTokens(line);
    expect(token).toMatchObject({ kind: 'context', valid: true, deprecated: true });
  });

  test('malformed tokens are located but marked invalid', () => {
    const line = 'Bad !not-a-date >also-bad ~2weeks &garbage #42';
    const tokens = locateTaskLineTokens(line);
    expect(tokens.filter(t => t.kind === 'due')).toEqual([expect.objectContaining({ valid: false })]);
    expect(tokens.filter(t => t.kind === 'defer')).toEqual([expect.objectContaining({ valid: false })]);
    expect(tokens.filter(t => t.kind === 'effort')).toEqual([expect.objectContaining({ valid: false })]);
    // `&garbage` has no boundary-delimited `(...)` so it never matches
    // TOKEN_PATTERN's `&` alternative at all — nothing to locate.
    expect(tokens.some(t => t.kind === 'actual')).toBe(false);
    const numericTag = tokens.find(t => t.kind === 'tag');
    expect(numericTag).toMatchObject({ valid: false });
    expect(spanText(line, numericTag!)).toBe('#42');
  });

  test('tokens inside wikilinks, embeds, and code spans are not located', () => {
    const line = 'Fix the `$PATH` handling in [[Deploy Notes]] and ![[diagram.png]] $5';
    const tokens = locateTaskLineTokens(line);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].kind).toBe('value');
    expect(spanText(line, tokens[0])).toBe('$5');
  });

  test('every valid span corresponds to a value tokenizeTaskLine actually extracted', () => {
    const line = 'Ship v2 parser !2026-04-20 >2026-04-10 @computer $9 %8 ~3days ' +
      '&(2026-04-05, 2026-04-18):9days #backend #sprint/12 ^ship-v2-parser';
    const tokens = locateTaskLineTokens(line);
    const result = tokenizeTaskLine(line);

    const due = tokens.find(t => t.kind === 'due')!;
    expect(spanText(line, due)).toBe(`!${result.dueDate}`);
    const defer = tokens.find(t => t.kind === 'defer')!;
    expect(spanText(line, defer)).toBe(`>${result.deferDate}`);
    const value = tokens.find(t => t.kind === 'value')!;
    expect(spanText(line, value)).toBe(`$${result.value}`);
    const complexity = tokens.find(t => t.kind === 'complexity')!;
    expect(spanText(line, complexity)).toBe(`%${result.complexity}`);
    const blockId = tokens.find(t => t.kind === 'blockId')!;
    expect(spanText(line, blockId)).toBe(`^${result.blockId}`);
    expect(tokens.filter(t => t.kind === 'tag')).toHaveLength(result.tags.length);
  });

  test('an empty line has no tokens', () => {
    expect(locateTaskLineTokens('')).toEqual([]);
  });

  test('a line with only a blockId locates just that span, from the caret', () => {
    const line = 'Plain description ^my-id';
    const [token] = locateTaskLineTokens(line);
    expect(token).toMatchObject({ kind: 'blockId', valid: true, deprecated: false });
    expect(line.slice(token.start, token.end)).toBe('^my-id');
  });
});
