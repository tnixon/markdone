import { DirectoryWorkspaceHandle } from '../directoryWorkspaceHandle';
import { InMemoryFileSystem } from '../inMemoryFileSystem';
import { discoverProjects } from '../discovery';
import { operationRegistry } from '../../operations/registry';

const MARKED = (extra = '') => `---\nmarkdone: 2\n${extra}---\n\n- [ ] A task\n`;

function opNamed(name: string) {
  return operationRegistry.find(o => o.name === name)!;
}

async function load(files: Record<string, string>) {
  const fs = new InMemoryFileSystem();
  for (const [path, content] of Object.entries(files)) await fs.write(path, content);
  const handle = new DirectoryWorkspaceHandle('ws', '', fs);
  await handle.reload();
  return { fs, handle };
}

const names = (handle: DirectoryWorkspaceHandle) => handle.listProjects().map(p => p.name);

describe('marker-based discovery', () => {
  test('a marked root file and a marked nested todo.md are both projects', async () => {
    const { handle } = await load({
      'reading-list.md': MARKED(),
      'home-network/todo.md': MARKED(),
    });
    expect(names(handle)).toEqual(['Inbox', 'home-network', 'reading-list']);
    expect(handle.listProjects().map(p => p.sourcePath)).toEqual(['inbox.md', 'home-network/todo.md', 'reading-list.md']);
    expect(handle.getProject('home-network/todo')?.name).toBe('home-network');
  });

  test('unmarked notes are never projects, including one full of plain checkboxes', async () => {
    const { handle } = await load({
      'notes.md': '# Notes\n\n- [ ] one\n- [x] two\n',
      'home-network/network-plan.md': '- [ ] plain\n',
      'real.md': MARKED(),
    });
    expect(names(handle)).toEqual(['Inbox', 'real']);
    const report = handle.discoveryReport();
    expect(report.unmarkedNotes.map(n => n.path).sort()).toEqual(['home-network/network-plan.md', 'notes.md']);
    expect(report.unmarkedNotes.every(n => !n.looksLikeTaskFile)).toBe(true);
  });

  test('an unmarked note that looks like a task file is flagged', async () => {
    const { handle } = await load({
      'a.md': '---\nlayout: kanban\n---\n',
      'b.md': '- [ ] call dentist !2026-05-01\n',
    });
    const flagged = handle.discoveryReport().unmarkedNotes.filter(n => n.looksLikeTaskFile).map(n => n.path);
    expect(flagged).toEqual(['a.md', 'b.md']);
  });

  test('hidden folders are skipped', async () => {
    const { handle } = await load({ '.obsidian/todo.md': MARKED(), 'real.md': MARKED() });
    expect(names(handle)).toEqual(['Inbox', 'real']);
  });

  test('node_modules is not descended into', async () => {
    const { handle } = await load({ 'node_modules/pkg/todo.md': MARKED(), 'real.md': MARKED() });
    expect(names(handle)).toEqual(['Inbox', 'real']);
  });

  test('symlinks are not followed', async () => {
    const fs = new InMemoryFileSystem();
    await fs.write('real.md', MARKED());
    await fs.write('linked/todo.md', MARKED());
    const base = fs.stat.bind(fs);
    fs.stat = async (path: string) => {
      const stat = await base(path);
      return path === 'linked' ? { ...stat, isSymlink: true } : stat;
    };
    const report = await discoverProjects(fs, '', { defaultsFileName: '_markdone.md' });
    expect(report.projects.map(p => p.path)).toEqual(['real.md']);
  });

  test('an unsupported marker is reported and skipped, never loaded', async () => {
    const { handle } = await load({
      'future.md': '---\nmarkdone: 3\n---\n- [ ] x\n',
      'junk.md': '---\nmarkdone: yes\n---\n- [ ] x\n',
      'real.md': MARKED(),
    });
    expect(names(handle)).toEqual(['Inbox', 'real']);
    const messages = handle.warnings().map(w => `${w.path}: ${w.message}`);
    expect(messages.some(m => m.startsWith('future.md') && m.includes('unsupported'))).toBe(true);
    expect(messages.some(m => m.startsWith('junk.md') && m.includes('unreadable'))).toBe(true);
    expect(handle.discoveryReport().skipped.map(s => s.status).sort()).toEqual(['unreadable', 'unsupported']);
  });

  test('_markdone.md and inbox.md have no special role in a subfolder', async () => {
    const { handle } = await load({
      'sub/inbox.md': '- [ ] ordinary note\n',
      'sub/_markdone.md': '- [ ] ordinary note\n',
      'sub/marked-inbox.md': MARKED(),
      'sub/inbox2.md': MARKED(),
    });
    // sub/inbox.md is unmarked -> ordinary note; the root inbox is created.
    expect(handle.discoveryReport().unmarkedNotes.map(n => n.path).sort()).toEqual(['sub/_markdone.md', 'sub/inbox.md']);
    expect(handle.listProjects().filter(p => p.name === 'Inbox')).toHaveLength(1);
  });
});

describe('discoveryReport', () => {
  test('is the report from the last reload(): reading it never touches the filesystem again', async () => {
    const { handle, fs } = await load({ 'a.md': MARKED(), 'sub/b.md': MARKED() });

    const calls = { list: 0, read: 0, stat: 0 };
    const wrap = <K extends 'list' | 'read' | 'stat'>(key: K) => {
      const original = fs[key].bind(fs) as (...args: unknown[]) => Promise<unknown>;
      (fs as unknown as Record<string, unknown>)[key] = (...args: unknown[]) => {
        calls[key]++;
        return original(...args);
      };
    };
    wrap('list');
    wrap('read');
    wrap('stat');

    const first = handle.discoveryReport();
    handle.discoveryReport();
    handle.listProjects();
    handle.warnings();

    expect(calls).toEqual({ list: 0, read: 0, stat: 0 });
    expect(handle.discoveryReport()).toBe(first);

    await handle.reload();
    expect(handle.discoveryReport()).not.toBe(first);
    expect(calls.list).toBeGreaterThan(0);
  });

  test('a reload walks each file once: one stat and one read per markdown file', async () => {
    const { handle, fs } = await load({ 'a.md': MARKED(), 'sub/b.md': MARKED() });
    const counts = new Map<string, number>();
    const original = fs.stat.bind(fs);
    fs.stat = async (path: string) => {
      counts.set(path, (counts.get(path) ?? 0) + 1);
      return original(path);
    };
    await handle.reload();
    for (const path of ['a.md', 'sub/b.md']) expect(counts.get(path)).toBe(1);
  });
});

describe('project names', () => {
  test('title, then first H1, then folder name (nested) or filename (root)', async () => {
    const { handle } = await load({
      'titled.md': '---\nmarkdone: 2\ntitle: Titled\n---\n# Ignored H1\n',
      'h1.md': '---\nmarkdone: 2\n---\n# From Heading\n',
      'plain.md': MARKED(),
      'a/todo.md': '---\nmarkdone: 2\n---\n# Nested H1\n',
      'home-network/todo.md': MARKED(),
    });
    expect(handle.getProject('titled')?.name).toBe('Titled');
    expect(handle.getProject('h1')?.name).toBe('From Heading');
    expect(handle.getProject('plain')?.name).toBe('plain');
    expect(handle.getProject('a/todo')?.name).toBe('Nested H1');
    expect(handle.getProject('home-network/todo')?.name).toBe('home-network');
  });

  test('a name collision keeps both projects and is reported with both paths', async () => {
    const { handle } = await load({ 'home.md': MARKED(), 'home/todo.md': MARKED() });
    expect(names(handle)).toEqual(['Inbox', 'home', 'home']);
    const dup = handle.warnings().find(w => w.message.includes('Duplicate project name'));
    expect(dup?.message).toContain('home.md');
    expect(dup?.message).toContain('home/todo.md');
  });
});

describe('inbox', () => {
  test('is created with the marker', async () => {
    const { fs } = await load({});
    expect(await fs.read('inbox.md')).toBe('---\nmarkdone: 2\n---\n');
  });

  test('an existing unmarked inbox.md still loads as the inbox', async () => {
    const { handle } = await load({ 'inbox.md': '- [ ] capture\n' });
    expect(names(handle)).toEqual(['Inbox']);
    expect(handle.discoveryReport().inboxMarker).toBe('absent');
  });
});

describe('projects: ordering', () => {
  test('root and nested entries are workspace-relative paths without extension', async () => {
    const { handle } = await load({
      '_markdone.md': '---\nprojects: [home-network/todo, zeta, missing]\n---\n',
      'alpha.md': MARKED(),
      'zeta.md': MARKED(),
      'home-network/todo.md': MARKED(),
    });
    expect(handle.listProjects().map(p => p.sourcePath)).toEqual([
      'inbox.md',
      'home-network/todo.md',
      'zeta.md',
      'alpha.md',
    ]);
    expect(handle.warnings().some(w => w.message.includes("'missing'"))).toBe(true);
  });
});

describe('addProject', () => {
  test('root form writes <slug>.md with the marker', async () => {
    const { handle, fs } = await load({});
    const result = await handle.applyOperation(opNamed('addProject'), { workspaceId: 'ws', name: 'Reading', layout: 'checklist' });
    expect(result.ok).toBe(true);
    expect(await fs.read('reading.md')).toContain('markdone: 2');
  });

  test('folder form writes <slug>/todo.md with the marker and a title that survives reload', async () => {
    const { handle, fs } = await load({});
    await handle.applyOperation(opNamed('addProject'), { workspaceId: 'ws', name: 'Home Network', layout: 'kanban', folder: true });
    const written = await fs.read('home-network/todo.md');
    expect(written).toContain('markdone: 2');
    expect(written).toContain('title: Home Network');
    expect(written).toContain('layout: kanban');
    await handle.reload();
    expect(handle.getProject('home-network/todo')).toMatchObject({ name: 'Home Network', layout: 'kanban' });
  });

  test('delete and rename touch only the task file, never its folder siblings', async () => {
    const { handle, fs } = await load({
      'home-network/todo.md': MARKED(),
      'home-network/network-plan.md': '# plan\n- [ ] plain\n',
    });
    const index = handle.listProjects().findIndex(p => p.sourcePath === 'home-network/todo.md');
    await handle.applyOperation(opNamed('updateProject'), { workspaceId: 'ws', projectIndex: index, changes: { name: 'LAN' } });
    expect(await fs.read('home-network/network-plan.md')).toBe('# plan\n- [ ] plain\n');
    await handle.applyOperation(opNamed('deleteProject'), { workspaceId: 'ws', projectIndex: index });
    await expect(fs.read('home-network/todo.md')).rejects.toThrow();
    expect(await fs.read('home-network/network-plan.md')).toBe('# plan\n- [ ] plain\n');
  });
});
