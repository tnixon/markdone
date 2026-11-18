import { App } from '../__tests__/fakeObsidian';
import type { TFile } from 'obsidian';
import { applyV1Conversion, previewV1Conversion } from './convertV1Syntax';

describe('previewV1Conversion', () => {
  test('normalizes v1 syntax and lists a warning per normalization', () => {
    const before = ['# Home', '', '- [ ] Fix leaky faucet @home *2hrs #maintenance'].join('\n');
    const preview = previewV1Conversion(before, 'home');
    expect(preview.unchanged).toBe(false);
    expect(preview.after).toContain('~2hrs');
    expect(preview.after).not.toContain('*2hrs');
    expect(preview.warnings.some(w => w.includes('Deprecated effort token'))).toBe(true);
    expect(preview.diff).toContain('*2hrs'); // the removed (old) line
    expect(preview.diff).toContain('~2hrs'); // the added (new) line
  });

  test('is unchanged for a file already in canonical v2 syntax', () => {
    const before = ['# Home', '', '- [ ] Buy milk @errands'].join('\n');
    const preview = previewV1Conversion(before, 'home');
    expect(preview.unchanged).toBe(true);
    expect(preview.after).toBe(before);
  });

  test('rewrites #key(value) to #key/value and @waiting to #waiting/unknown', () => {
    const before = ['# Inbox', '', '- [ ] Old tag #sprint(4)', '- [ ] Old waiting @waiting'].join('\n');
    const preview = previewV1Conversion(before, 'inbox');
    expect(preview.after).toContain('#sprint/4');
    expect(preview.after).toContain('#waiting/unknown');
  });
});

describe('applyV1Conversion', () => {
  test('writes the converted content when the live file still matches the preview\'s "before"', async () => {
    const before = ['# Home', '', '- [ ] Task *2hrs'].join('\n');
    const app = new App({ 'home.md': before });
    const file = app.vault.getAbstractFileByPath('home.md') as unknown as TFile;
    const preview = previewV1Conversion(before, 'home');

    const applied = await applyV1Conversion(app as any, file, preview);

    expect(applied).toBe(true);
    expect(app.vault.fileContent('home.md')).toBe(preview.after);
  });

  test('refuses to write when the live file changed since the preview was computed', async () => {
    const before = ['# Home', '', '- [ ] Task *2hrs'].join('\n');
    const preview = previewV1Conversion(before, 'home');
    const app = new App({ 'home.md': 'changed-elsewhere' });
    const file = app.vault.getAbstractFileByPath('home.md') as unknown as TFile;

    const applied = await applyV1Conversion(app as any, file, preview);

    expect(applied).toBe(false);
    expect(app.vault.fileContent('home.md')).toBe('changed-elsewhere');
  });
});
