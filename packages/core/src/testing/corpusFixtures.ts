import * as fsNode from 'node:fs';
import * as path from 'node:path';
import type { InMemoryFileSystem } from '../storage/inMemoryFileSystem';

const CORPUS_DIR = path.resolve(__dirname, '../../../../spec/corpus');

// Mirrors this package's own src/__tests__/corpus.test.ts convention: every
// fixture opens with an HTML comment describing what it covers, stripped
// (through and including the line containing `-->`) before use.
export function stripLeadingComment(text: string): string {
  const lines = text.split('\n');
  const end = lines.findIndex(l => l.trim() === '-->');
  return end === -1 ? text : lines.slice(end + 1).join('\n');
}

export function loadCorpusFile(name: string): string {
  return stripLeadingComment(fsNode.readFileSync(path.join(CORPUS_DIR, `${name}.md`), 'utf8'));
}

// Seeds an InMemoryFileSystem with a single-file corpus fixture at the given
// path (default 'todo.md').
export async function seedFileModeFixture(fs: InMemoryFileSystem, name: string, atPath = 'todo.md'): Promise<void> {
  await fs.write(atPath, loadCorpusFile(name));
}

// Every file of a directory-mode corpus fixture (recursively, hidden folders
// included), keyed by its fixture-relative path, with the leading authoring
// comment stripped.
export function readDirectoryModeFixture(name = 'directory-mode'): Record<string, string> {
  const root = path.join(CORPUS_DIR, name);
  const files: Record<string, string> = {};
  const walk = (rel: string): void => {
    for (const entry of fsNode.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      const relPath = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(relPath);
      else if (entry.name.endsWith('.md')) {
        files[relPath] = stripLeadingComment(fsNode.readFileSync(path.join(root, relPath), 'utf8'));
      }
    }
  };
  walk('');
  return files;
}

// Seeds an InMemoryFileSystem with a directory-mode corpus fixture's files
// under the given directory path (default 'workspace'). `name` defaults to
// the original `directory-mode` fixture.
export async function seedDirectoryModeFixture(fs: InMemoryFileSystem, atDir = 'workspace', name = 'directory-mode'): Promise<void> {
  for (const [relPath, content] of Object.entries(readDirectoryModeFixture(name))) {
    await fs.write(`${atDir}/${relPath}`, content);
  }
}
