import type { Frontmatter } from '../model/types';
import { classifyMarker, parseFrontmatter, type MarkerStatus } from '../parser/frontmatter';
import { parseCheckboxLine, tokenizeTaskLine } from '../parser/tokenize';
import type { FileSystem } from './fileSystem';

// Directory-mode discovery, implemented once (spec: "Directory Mode"): a
// project is any `.md` file under the workspace root, at any depth, whose
// frontmatter has a supported `markdone` marker. Every consumer that needs to
// know which files are projects goes through `discoverProjects`; nothing else
// enumerates a workspace folder.

export const INBOX_FILE_NAME = 'inbox.md';

// Folders discovery never descends into, besides hidden (dot-prefixed) ones:
// dependency trees that a workspace folder pointed at a repository root would
// otherwise make it walk and read in full.
const SKIPPED_FOLDER_NAMES: ReadonlySet<string> = new Set(['node_modules']);

export interface DiscoveredFile {
  // Workspace-relative path, `.md` included, `/`-separated.
  path: string;
  // `path` without the `.md` extension — the project's stable identifier, and
  // the form `projects:` ordering entries use.
  id: string;
  content: string;
  frontmatter: Frontmatter;
  frontmatterWarning?: string;
  // Name of the folder holding the file; undefined for a root file.
  parentFolder?: string;
  isInbox: boolean;
  mtimeMs: number | undefined;
}

export interface SkippedFile {
  path: string;
  status: Extract<MarkerStatus, 'unsupported' | 'unreadable'>;
  marker: unknown;
}

export interface UnmarkedNote {
  path: string;
  // Frontmatter `layout`/`columns`, or a task line carrying Markdone tokens —
  // i.e. it looks like someone meant it to be a project.
  looksLikeTaskFile: boolean;
  // Kept only when `looksLikeTaskFile`, so lint can offer an add-marker fix
  // without holding every ordinary note in a large vault in memory.
  content?: string;
}

export interface DiscoveryReport {
  // Marked, supported files. Excludes the inbox and the defaults note.
  projects: DiscoveredFile[];
  // Root `inbox.md`, marked or not (an unmarked one is still the inbox).
  inbox?: DiscoveredFile;
  inboxMarker?: MarkerStatus;
  // Root defaults note, if present.
  defaults?: DiscoveredFile;
  skipped: SkippedFile[];
  unmarkedNotes: UnmarkedNote[];
}

export interface DiscoveryOptions {
  defaultsFileName: string;
}

function joinPath(dir: string, name: string): string {
  return dir === '' ? name : `${dir.replace(/\/+$/, '')}/${name}`;
}

function isMarkdownFile(fileName: string): boolean {
  return /\.md$/i.test(fileName);
}

function stripExtension(path: string): string {
  return path.replace(/\.md$/i, '');
}

export function looksLikeTaskFile(content: string, frontmatter: Frontmatter): boolean {
  if (frontmatter.recognized.layout !== undefined || frontmatter.recognized.columns !== undefined) return true;
  return content.split('\n').some(line => {
    const checkbox = parseCheckboxLine(line);
    if (!checkbox) return false;
    const t = tokenizeTaskLine(checkbox.rest);
    return (
      t.dueDate !== undefined ||
      t.deferDate !== undefined ||
      t.contexts.length > 0 ||
      t.value !== undefined ||
      t.complexity !== undefined ||
      t.effort !== undefined ||
      t.actual !== undefined ||
      t.tags.length > 0 ||
      t.blockId !== undefined
    );
  });
}

// `mtimeMs` comes from the `stat` the walk already took — not a second one.
async function readFile(
  fs: FileSystem,
  root: string,
  relPath: string,
  isInbox: boolean,
  mtimeMs: number,
): Promise<DiscoveredFile> {
  const fullPath = joinPath(root, relPath);
  const content = await fs.read(fullPath);
  const { frontmatter, warning } = parseFrontmatter(content);
  const slash = relPath.lastIndexOf('/');
  const parentFolder = slash === -1 ? undefined : relPath.slice(0, slash).split('/').pop();
  return {
    path: relPath,
    id: stripExtension(relPath),
    content,
    frontmatter,
    frontmatterWarning: warning,
    parentFolder,
    isInbox,
    mtimeMs,
  };
}

export async function discoverProjects(fs: FileSystem, root: string, options: DiscoveryOptions): Promise<DiscoveryReport> {
  const report: DiscoveryReport = { projects: [], skipped: [], unmarkedNotes: [] };

  async function walk(relDir: string): Promise<void> {
    // `joinPath(root, '')` would leave a trailing slash, which a vault-backed
    // filesystem doesn't resolve as the folder.
    const names = await fs.list(relDir === '' ? root : joinPath(root, relDir));
    for (const name of [...names].sort()) {
      if (name.startsWith('.') || SKIPPED_FOLDER_NAMES.has(name)) continue;
      const relPath = joinPath(relDir, name);
      const fullPath = joinPath(root, relPath);

      let stat;
      try {
        stat = await fs.stat(fullPath);
      } catch {
        continue; // vanished between list and stat
      }
      if (stat.isSymlink) continue;
      if (stat.isDirectory) {
        await walk(relPath);
        continue;
      }
      if (!isMarkdownFile(name)) continue;

      const atRoot = relDir === '';
      if (atRoot && name.toLowerCase() === INBOX_FILE_NAME) {
        const file = await readFile(fs, root, relPath, true, stat.mtimeMs);
        report.inbox = file;
        report.inboxMarker = classifyMarker(file.frontmatter.recognized.markdone);
        continue;
      }
      if (atRoot && name === options.defaultsFileName) {
        report.defaults = await readFile(fs, root, relPath, false, stat.mtimeMs);
        continue;
      }

      const file = await readFile(fs, root, relPath, false, stat.mtimeMs);
      const marker = file.frontmatter.recognized.markdone;
      const status = classifyMarker(marker);
      if (status === 'supported') {
        report.projects.push(file);
      } else if (status === 'absent') {
        const taskLike = looksLikeTaskFile(file.content, file.frontmatter);
        report.unmarkedNotes.push({ path: relPath, looksLikeTaskFile: taskLike, ...(taskLike && { content: file.content }) });
      } else {
        report.skipped.push({ path: relPath, status, marker });
      }
    }
  }

  await walk('');
  return report;
}
