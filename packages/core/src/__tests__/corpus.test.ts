// Conformance harness for spec/corpus — see spec/corpus/README.md's
// "Harness Contract". For every fixture: (1) parse it and assert the
// result matches `<fixture>.expected.json`; (2) serialize the parsed
// result and assert it matches the fixture's expected output, which is
// byte-identical to the source except where the fixture deliberately
// exercises a Normalizations-table row (recorded as `expectedSerialized`
// in the JSON, alongside the source itself for fixtures that round-trip
// unchanged).
//
// Every corpus fixture opens with an HTML comment documenting what it
// covers — fixture-authoring metadata, not part of the Markdone file under
// test. `stripLeadingComment` removes it before parsing; frontmatter must
// be the literal first bytes of the file per spec ("Frontmatter"), so a
// leading comment would otherwise defeat every fixture's own frontmatter
// recognition.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse, parseProject, _resetIdCounter } from '../parser/parse';
import { serialize, serializeProject } from '../parser/serialize';
import { DirectoryWorkspaceHandle } from '../storage/directoryWorkspaceHandle';
import { InMemoryFileSystem } from '../storage/inMemoryFileSystem';
import { readDirectoryModeFixture } from '../testing/corpusFixtures';

const CORPUS_DIR = path.resolve(__dirname, '../../../../spec/corpus');

function stripLeadingComment(content: string): string {
  const lines = content.split('\n');
  const endIndex = lines.findIndex(l => l.trim() === '-->');
  return endIndex === -1 ? content : lines.slice(endIndex + 1).join('\n');
}

function loadFixture(name: string): string {
  return stripLeadingComment(fs.readFileSync(path.join(CORPUS_DIR, `${name}.md`), 'utf8'));
}

function loadExpected(name: string): any {
  return JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, `${name}.expected.json`), 'utf8'));
}

const FILE_MODE_FIXTURES = [
  'file-mode',
  'all-tokens',
  'deprecated-v1',
  'dollar-escaping',
  'malformed',
  'subtasks',
  'wikilinks',
];

const PROJECT_MODE_FIXTURES = ['frontmatter-unknown-keys', 'obsidian-note'];

describe.each(FILE_MODE_FIXTURES)('corpus: %s.md (file mode)', name => {
  test('parses to the expected result', () => {
    _resetIdCounter();
    const result = parse(loadFixture(name));
    const expected = loadExpected(name);
    expect(result.file).toEqual(expected.file);
    expect(result.warnings).toEqual(expected.warnings);
  });

  test('serializes to the expected output', () => {
    _resetIdCounter();
    const { file } = parse(loadFixture(name));
    expect(serialize(file)).toBe(loadExpected(name).expectedSerialized);
  });
});

describe.each(PROJECT_MODE_FIXTURES)('corpus: %s.md (directory-mode project file)', name => {
  test('parses to the expected result', () => {
    _resetIdCounter();
    const result = parseProject(loadFixture(name), { filenameFallback: name });
    const expected = loadExpected(name);
    expect(result.project).toEqual(expected.project);
    expect(result.warnings).toEqual(expected.warnings);
  });

  test('serializes to the expected output', () => {
    _resetIdCounter();
    const { project } = parseProject(loadFixture(name), { filenameFallback: name });
    expect(serializeProject(project)).toBe(loadExpected(name).expectedSerialized);
  });
});

// Directory-mode fixtures are whole workspaces, loaded through core's own
// loader (never a re-implementation of discovery or ordering here). The
// harness only strips each file's authoring comment, seeds an in-memory
// filesystem, and compares the loader's result to `<fixture>.expected.json`.
const DIRECTORY_FIXTURES = ['directory-mode', 'directory-mode-nested'];

async function loadDirectoryFixture(name: string) {
  const memFs = new InMemoryFileSystem();
  const sources = readDirectoryModeFixture(name);
  for (const [relPath, content] of Object.entries(sources)) await memFs.write(relPath, content);

  _resetIdCounter();
  const handle = new DirectoryWorkspaceHandle(name, '', memFs);
  await handle.reload();

  const projects = handle.listProjects();
  const idOf = (sourcePath: string | undefined) => (sourcePath ?? '').replace(/\.md$/i, '');
  const report = handle.discoveryReport();
  const snapshot = {
    defaultsFrontmatter: report.defaults?.frontmatter,
    order: projects.map(p => idOf(p.sourcePath)),
    projects: Object.fromEntries(projects.map(p => [idOf(p.sourcePath), p])),
    warnings: handle.warnings(),
    skipped: report.skipped,
    unmarkedNotes: report.unmarkedNotes.map(({ path: notePath, looksLikeTaskFile }) => ({ path: notePath, looksLikeTaskFile })),
  };
  return { snapshot, projects, sources };
}

describe.each(DIRECTORY_FIXTURES)('corpus: %s/ (a whole workspace)', name => {
  test('the loader finds exactly the expected projects, order, warnings and unmarked notes', async () => {
    const { snapshot } = await loadDirectoryFixture(name);
    // JSON round-trip so `undefined` fields compare like the stored JSON.
    expect(JSON.parse(JSON.stringify(snapshot))).toEqual(loadExpected(name));
  });

  test('every loaded project file round-trips byte-for-byte', async () => {
    const { projects, sources } = await loadDirectoryFixture(name);
    for (const project of projects) {
      expect(serializeProject(project)).toBe(sources[project.sourcePath!]);
    }
  });

  test('unmarked notes and skipped files never become projects', async () => {
    const { snapshot, projects } = await loadDirectoryFixture(name);
    const loaded = new Set(projects.map(p => p.sourcePath));
    for (const note of snapshot.unmarkedNotes) expect(loaded.has(note.path)).toBe(false);
    for (const skipped of snapshot.skipped) expect(loaded.has(skipped.path)).toBe(false);
  });
});
