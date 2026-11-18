import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

// Checks SKILL.md's frontmatter against the Agent Skills format
// (https://agentskills.io/specification) without a network call — this is
// the no-network half of the format guard; the upstream reference
// validator (`uvx --from skills-ref agentskills validate markdone`, see this
// package's README) is the belt-and-suspenders network check run by hand.
describe('markdone/SKILL.md format', () => {
  const skillRoot = path.resolve(__dirname, '../../markdone');
  const skillMdPath = path.join(skillRoot, 'SKILL.md');
  const raw = readFileSync(skillMdPath, 'utf8');

  function parseFrontmatter(markdown: string): { frontmatter: Record<string, unknown>; body: string } {
    const lines = markdown.split('\n');
    expect(lines[0]).toBe('---');
    const endIndex = lines.indexOf('---', 1);
    expect(endIndex).toBeGreaterThan(0);
    const frontmatter = parseYaml(lines.slice(1, endIndex).join('\n')) as Record<string, unknown>;
    const body = lines.slice(endIndex + 1).join('\n');
    return { frontmatter, body };
  }

  const { frontmatter, body } = parseFrontmatter(raw);

  test('name matches the parent directory and the spec\'s charset', () => {
    expect(frontmatter.name).toBe(path.basename(skillRoot));
    expect(frontmatter.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect((frontmatter.name as string).length).toBeLessThanOrEqual(64);
  });

  test('description is present and within the 1024-character limit', () => {
    expect(typeof frontmatter.description).toBe('string');
    const description = frontmatter.description as string;
    expect(description.length).toBeGreaterThan(0);
    expect(description.length).toBeLessThanOrEqual(1024);
  });

  test('compatibility, if present, is within the 500-character limit', () => {
    if (frontmatter.compatibility === undefined) return;
    expect(typeof frontmatter.compatibility).toBe('string');
    expect((frontmatter.compatibility as string).length).toBeLessThanOrEqual(500);
  });

  test('metadata, if present, is a string-to-string map', () => {
    if (frontmatter.metadata === undefined) return;
    for (const value of Object.values(frontmatter.metadata as Record<string, unknown>)) {
      expect(typeof value).toBe('string');
    }
  });

  test('only spec-defined top-level keys are present', () => {
    const allowed = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
    for (const key of Object.keys(frontmatter)) {
      expect(allowed.has(key)).toBe(true);
    }
  });

  test('SKILL.md body stays under the recommended 500-line budget', () => {
    expect(raw.split('\n').length).toBeLessThanOrEqual(500);
  });

  function collectMarkdownFiles(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return collectMarkdownFiles(full);
      return entry.name.endsWith('.md') ? [full] : [];
    });
  }

  test('every relative Markdown link resolves to a real file', () => {
    const readmePath = path.resolve(skillRoot, '../README.md');
    // TODO_FORMAT.md is a byte-for-byte vendored copy of spec/TODO_FORMAT.md
    // (see reference.test.ts) — its links are written relative to the
    // spec's own location in the monorepo, not this skill, so it's excluded
    // here the same way it's excluded from the v2 example-conformance test.
    const vendoredSpecPath = path.join(skillRoot, 'reference/TODO_FORMAT.md');
    const files = [...collectMarkdownFiles(skillRoot), readmePath].filter(f => f !== vendoredSpecPath);
    const linkPattern = /\[[^\]]*\]\((?!https?:\/\/|#)([^)]+)\)/g;

    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(linkPattern)) {
        const target = match[1].split('#')[0];
        if (!target) continue; // pure in-page anchor
        const resolved = path.resolve(path.dirname(file), target);
        // A link may point at a file or, as the README's install
        // instructions do ("the markdone/ directory itself"), a directory.
        expect(existsSync(resolved)).toBe(true);
      }
    }
  });

  test('links inside SKILL.md stay one level deep (no reference/ chaining)', () => {
    const linkPattern = /\[[^\]]*\]\((?!https?:\/\/|#)([^)]+)\)/g;
    for (const match of body.matchAll(linkPattern)) {
      const target = match[1].split('#')[0];
      expect(target.split('/').length).toBeLessThanOrEqual(2);
    }
  });
});
