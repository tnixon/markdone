import { DirectoryWorkspaceHandle } from '../directoryWorkspaceHandle';
import { InMemoryFileSystem } from '../inMemoryFileSystem';
import { ExternalChangeError } from '../errors';
import { operationRegistry } from '../../operations/registry';
import type { OperationDefinition } from '../../operations/types';
import type { KanbanProject } from '../../model/types';

function opNamed(name: string): OperationDefinition {
  const op = operationRegistry.find(o => o.name === name);
  if (!op) throw new Error(`No such operation: ${name}`);
  return op;
}

// A minimal directory-mode workspace, hand-written per TODO_FORMAT.md's
// "Directory Mode" section — not the annotated spec/corpus fixtures, whose
// leading HTML-comment convention is a step-6 (conformance harness) concern
// unrelated to WorkspaceHandle itself.
const DEFAULTS_MD = [
  '---',
  'owner: alice',
  'layout: checklist',
  'priority: 1',
  'projects: [website-redesign, reading-list]',
  '---',
  '',
  'Shared task workspace.',
].join('\n');

const INBOX_MD = ['---', 'markdone: 2', 'title: Inbox', '---', '', '- [ ] Unsorted thought'].join('\n');

const WEBSITE_MD = [
  '---',
  'markdone: 2',
  'title: Website Redesign',
  'layout: kanban',
  'columns: [Next, Later, Waiting, Done]',
  '---',
  '',
  '## Next',
  '',
  '- [ ] Wireframe landing page',
  '',
  '## Later',
  '',
  '## Waiting',
  '',
  '## Done',
].join('\n');

const READING_LIST_MD = [
  '---',
  'markdone: 2',
  'status: someday',
  '---',
  '',
  '# Reading List',
  '',
  '- [ ] Deep Work',
].join('\n');

async function seedWorkspace(target: InMemoryFileSystem): Promise<void> {
  await target.write('_markdone.md', DEFAULTS_MD);
  await target.write('inbox.md', INBOX_MD);
  await target.write('website-redesign.md', WEBSITE_MD);
  await target.write('reading-list.md', READING_LIST_MD);
}

describe('DirectoryWorkspaceHandle', () => {
  describe('a fresh empty directory', () => {
    test('creates inbox.md and yields a single Inbox project', async () => {
      const memFs = new InMemoryFileSystem();
      const handle = new DirectoryWorkspaceHandle('ws-1', '', memFs);
      await handle.reload();

      expect(handle.listProjects()).toEqual([expect.objectContaining({ name: 'Inbox', layout: 'checklist' })]);
      expect(await memFs.read('inbox.md')).toBe('---\nmarkdone: 2\n---\n');
    });
  });

  describe('against a seeded workspace', () => {
    let memFs: InMemoryFileSystem;
    let handle: DirectoryWorkspaceHandle;

    beforeEach(async () => {
      memFs = new InMemoryFileSystem();
      await seedWorkspace(memFs);
      handle = new DirectoryWorkspaceHandle('ws-1', '', memFs);
      await handle.reload();
    });

    test('orders projects per _markdone.md, with the inbox always first', () => {
      expect(handle.listProjects().map(p => p.name)).toEqual(['Inbox', 'Website Redesign', 'Reading List']);
    });

    test('getProject looks up by filename stem', () => {
      expect(handle.getProject('inbox')?.name).toBe('Inbox');
      expect(handle.getProject('website-redesign')?.name).toBe('Website Redesign');
      expect(handle.getProject('reading-list')?.name).toBe('Reading List');
      expect(handle.getProject('does-not-exist')).toBeUndefined();
    });

    test('a project inherits owner/priority from _markdone.md when it declares neither', () => {
      const readingList = handle.getProject('reading-list')!;
      expect(readingList.frontmatter.recognized.owner).toBe('alice');
      expect(readingList.frontmatter.recognized.priority).toBe(1);
      // The inherited values must not have been written into the file itself.
      expect(readingList.frontmatter.raw).not.toMatch(/owner:|priority:/);
    });

    test('a project keeps its own declared layout/columns over the workspace defaults', () => {
      const website = handle.getProject('website-redesign') as KanbanProject;
      expect(website.layout).toBe('kanban');
      expect(website.columnOrder).toEqual(['Next', 'Later', 'Waiting', 'Done']);
    });

    test('applyOperation on the inbox writes only inbox.md', async () => {
      const result = await handle.applyOperation(opNamed('addTask'), {
        workspaceId: 'ws-1',
        projectIndex: 0,
        task: { text: 'New capture' },
      });
      expect(result.ok).toBe(true);

      expect(await memFs.read('inbox.md')).toContain('New capture');
      // Untouched project files are byte-for-byte unchanged.
      expect(await memFs.read('website-redesign.md')).toBe(WEBSITE_MD);
      expect(await memFs.read('reading-list.md')).toBe(READING_LIST_MD);
    });

    test('addColumn on one kanban project only writes that project file', async () => {
      const website = handle.getProject('website-redesign')!;
      const projectIndex = handle.listProjects().indexOf(website);

      const result = await handle.applyOperation(opNamed('addColumn'), {
        workspaceId: 'ws-1',
        projectIndex,
        columnName: 'Blocked',
      });
      expect(result.ok).toBe(true);

      const written = await memFs.read('website-redesign.md');
      expect(written).toContain('## Blocked');
      expect(written).toMatch(/columns:[\s\S]*- Next[\s\S]*- Later[\s\S]*- Waiting[\s\S]*- Done[\s\S]*- Blocked/);

      expect(await memFs.read('inbox.md')).toBe(INBOX_MD);
      expect(await memFs.read('reading-list.md')).toBe(READING_LIST_MD);
    });

    test('renaming a project writes its title into frontmatter', async () => {
      const projectIndex = handle.listProjects().findIndex(p => p.name === 'Reading List');

      const result = await handle.applyOperation(opNamed('updateProject'), {
        workspaceId: 'ws-1',
        projectIndex,
        changes: { name: 'Books To Read' },
      });
      expect(result.ok).toBe(true);
      expect(handle.getProject('reading-list')?.name).toBe('Books To Read');

      const written = await memFs.read('reading-list.md');
      expect(written).toMatch(/title:\s*Books To Read/);
    });

    test('deleteProject removes the file and the ordering entry', async () => {
      const projectIndex = handle.listProjects().findIndex(p => p.name === 'Website Redesign');

      const result = await handle.applyOperation(opNamed('deleteProject'), {
        workspaceId: 'ws-1',
        projectIndex,
      });
      expect(result.ok).toBe(true);
      expect(handle.getProject('website-redesign')).toBeUndefined();
      await expect(memFs.stat('website-redesign.md')).rejects.toThrow();

      const defaultsFile = await memFs.read('_markdone.md');
      expect(defaultsFile).not.toContain('website-redesign');
    });

    test('reorderProject rewrites the ordering list in _markdone.md, not any project file', async () => {
      const projectIndex = handle.listProjects().findIndex(p => p.name === 'Reading List');

      const result = await handle.applyOperation(opNamed('reorderProject'), {
        workspaceId: 'ws-1',
        projectIndex,
        newIndex: 1,
      });
      expect(result.ok).toBe(true);
      expect(handle.listProjects().map(p => p.name)).toEqual(['Inbox', 'Reading List', 'Website Redesign']);

      expect(await memFs.read('reading-list.md')).toBe(READING_LIST_MD);
      expect(await memFs.read('website-redesign.md')).toBe(WEBSITE_MD);

      const defaultsFile = await memFs.read('_markdone.md');
      expect(defaultsFile).toMatch(/reading-list/);
    });

    test('addProject creates a new file named from a slug of the project name', async () => {
      const result = await handle.applyOperation(opNamed('addProject'), {
        workspaceId: 'ws-1',
        name: 'Q3 Planning!',
        layout: 'checklist',
      });
      expect(result.ok).toBe(true);
      expect(handle.getProject('q3-planning')?.name).toBe('Q3 Planning!');
      expect(await memFs.stat('q3-planning.md')).toBeDefined();
    });

    test('applyOperation dispatches applyBatch, which is not in the task/project-only operationHandlers map', async () => {
      const result = await handle.applyOperation(opNamed('applyBatch'), {
        operations: [
          { op: 'addTask', params: { workspaceId: 'ws-1', projectIndex: 0, task: { text: 'Batched capture' } } },
        ],
      });
      expect(result.ok).toBe(true);
      expect(await memFs.read('inbox.md')).toContain('Batched capture');
    });

    test('deleteProject throws ExternalChangeError when the target project file changed since load', async () => {
      const projectIndex = handle.listProjects().findIndex(p => p.name === 'Website Redesign');

      // Simulate an external edit to the file this delete is about to remove.
      await memFs.write('website-redesign.md', WEBSITE_MD + '\n- [ ] Someone else added this');

      await expect(
        handle.applyOperation(opNamed('deleteProject'), { workspaceId: 'ws-1', projectIndex }),
      ).rejects.toThrow(ExternalChangeError);
      // Rejected before any write: the file (edited) and the order list are untouched.
      expect(await memFs.read('_markdone.md')).toBe(DEFAULTS_MD);
    });

    test('deleteProject throws ExternalChangeError when _markdone.md changed since load', async () => {
      const projectIndex = handle.listProjects().findIndex(p => p.name === 'Website Redesign');

      // Simulate an external edit to the order list this delete would also rewrite.
      await memFs.write('_markdone.md', DEFAULTS_MD.replace('alice', 'bob'));

      await expect(
        handle.applyOperation(opNamed('deleteProject'), { workspaceId: 'ws-1', projectIndex }),
      ).rejects.toThrow(ExternalChangeError);
      expect(await memFs.stat('website-redesign.md')).toBeDefined();
    });

    test('reorderProject throws ExternalChangeError when _markdone.md changed since load', async () => {
      const projectIndex = handle.listProjects().findIndex(p => p.name === 'Reading List');

      await memFs.write('_markdone.md', DEFAULTS_MD.replace('alice', 'bob'));

      await expect(
        handle.applyOperation(opNamed('reorderProject'), { workspaceId: 'ws-1', projectIndex, newIndex: 1 }),
      ).rejects.toThrow(ExternalChangeError);
      // Rejected before any write: the external edit is what's there, untouched further.
      expect(await memFs.read('_markdone.md')).toBe(DEFAULTS_MD.replace('alice', 'bob'));
    });

    test('applyOperation reports the exact content it wrote, not a second independent plan (addTask mints a fresh random ^id per call)', async () => {
      const result = await handle.applyOperation(opNamed('addTask'), {
        workspaceId: 'ws-1',
        projectIndex: 0,
        task: { text: 'New capture' },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const change = result.value.changes.find(c => c.path === 'inbox.md');
      expect(change).toBeDefined();
      expect(change!.after).toBe(await memFs.read('inbox.md'));
    });

    test('addProject does not check _markdone.md mtime, since it never writes to it', async () => {
      // An external edit to an unrelated file (the order list) must not block
      // an operation that never touches that file.
      await memFs.write('_markdone.md', DEFAULTS_MD.replace('alice', 'bob'));

      const result = await handle.applyOperation(opNamed('addProject'), {
        workspaceId: 'ws-1',
        name: 'Fresh Project',
        layout: 'checklist',
      });
      expect(result.ok).toBe(true);
      expect(handle.getProject('fresh-project')?.name).toBe('Fresh Project');
    });

    test('addProject throws ExternalChangeError when a file already exists at the target slugified path, created after load', async () => {
      // planAdd's slug/dedup logic only knows about entries loaded at
      // reload() time; a file created externally afterward at that exact
      // path must not be silently overwritten just because it wasn't loaded.
      await memFs.write('fresh-project.md', '---\ntitle: Fresh Project\n---\n\n- [ ] Already here');

      await expect(
        handle.applyOperation(opNamed('addProject'), { workspaceId: 'ws-1', name: 'Fresh Project', layout: 'checklist' }),
      ).rejects.toThrow(ExternalChangeError);
      expect(await memFs.read('fresh-project.md')).toContain('Already here');
    });
  });

  describe('a workspace with no _markdone.md at load time', () => {
    test('a mutation that writes the order list throws ExternalChangeError if _markdone.md was created externally after load', async () => {
      const memFs = new InMemoryFileSystem();
      await memFs.write('inbox.md', '');
      await memFs.write('alpha.md', '---\nmarkdone: 2\ntitle: Alpha\n---\n\n- [ ] A');
      await memFs.write('beta.md', '---\nmarkdone: 2\ntitle: Beta\n---\n\n- [ ] B');
      const handle = new DirectoryWorkspaceHandle('ws-2', '', memFs);
      await handle.reload();

      // Someone else creates _markdone.md after this handle loaded (when it
      // didn't exist), before a reorder tries to write the order list into it.
      await memFs.write('_markdone.md', '---\nowner: someone-else\n---\n');

      // newIndex 0 is reserved for the inbox; reorder among the other two.
      const alphaIndex = handle.listProjects().findIndex(p => p.name === 'Alpha');
      await expect(
        handle.applyOperation(opNamed('reorderProject'), { workspaceId: 'ws-2', projectIndex: alphaIndex, newIndex: 2 }),
      ).rejects.toThrow(ExternalChangeError);
      // The externally-created file is untouched, not clobbered.
      expect(await memFs.read('_markdone.md')).toBe('---\nowner: someone-else\n---\n');
    });
  });
});
