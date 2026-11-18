import { InMemoryFileSystem, parseProject } from '@markdone/core';
import { runCli, seedFileModeFixture, seedDirectoryModeFixture, loadCorpusFile } from './helpers';

describe('mutation commands — file mode (spec/corpus/file-mode.md)', () => {
  let fs: InMemoryFileSystem;

  beforeEach(async () => {
    fs = new InMemoryFileSystem();
    await seedFileModeFixture(fs, 'file-mode', 'todo.md');
  });

  test('--dry-run computes a diff without writing', async () => {
    const before = await fs.read('todo.md');
    const { code, stdout } = await runCli(fs, [
      '--workspace', 'todo.md', 'add', 'New task', '--project', 'Errands', '--dry-run',
    ]);
    expect(code).toBe(0);
    expect(stdout.join('\n')).toContain('+');
    expect(stdout.join('\n')).toContain('New task');
    expect(await fs.read('todo.md')).toBe(before);
  });

  test('add without --dry-run writes the new task to the file', async () => {
    const { code } = await runCli(fs, ['--workspace', 'todo.md', 'add', 'New task', '--project', 'Errands', '--value', '5']);
    expect(code).toBe(0);
    const after = await fs.read('todo.md');
    expect(after).toContain('New task');
    expect(after).toContain('$5');
  });

  test('the applied --json outcome reports the auto-assigned ^id that was actually written, not a separately-minted one', async () => {
    const { code, stdout } = await runCli(fs, ['--workspace', 'todo.md', '--json', 'add', 'New task', '--project', 'Errands']);
    expect(code).toBe(0);
    const outcome = JSON.parse(stdout.join('\n'));
    const reportedId = outcome.changes[0].after.match(/New task \^(\S+)/)[1];
    const onDisk = await fs.read('todo.md');
    expect(onDisk).toContain(`New task ^${reportedId}`);
  });

  test('update --text rewrites the task text', async () => {
    const { code } = await runCli(fs, ['--workspace', 'todo.md', 'update', '--project', 'Errands', '--index', '0', '--text', 'Buy organic groceries']);
    expect(code).toBe(0);
    const after = await fs.read('todo.md');
    expect(after).toContain('Buy organic groceries');
    expect(after).not.toContain('Buy groceries');
  });

  test('update-subtask --text rewrites the subtask text', async () => {
    const { code } = await runCli(fs, [
      '--workspace', 'todo.md', 'update-subtask', '--project', 'Website Redesign', '--column', '1', '--index', '0', '--subtask', '0', '--text', 'Desktop layout v2',
    ]);
    expect(code).toBe(0);
    expect(await fs.read('todo.md')).toContain('Desktop layout v2');
  });

  test('update with both a positional and --text is a usage error', async () => {
    const { code, stderr } = await runCli(fs, ['--workspace', 'todo.md', 'update', 'Other', '--project', 'Errands', '--index', '0', '--text', 'New']);
    expect(code).not.toBe(0);
    expect(stderr.join('\n')).toContain('either as a positional argument or via --text');
  });

  test('update-subtask with both a positional and --text is a usage error', async () => {
    const { code, stderr } = await runCli(fs, [
      '--workspace', 'todo.md', 'update-subtask', 'Other', '--project', 'Website Redesign', '--column', '1', '--index', '0', '--subtask', '0', '--text', 'New',
    ]);
    expect(code).not.toBe(0);
    expect(stderr.join('\n')).toContain('either as a positional argument or via --text');
  });

  test('update-subtask with no change flags is a usage error', async () => {
    const before = await fs.read('todo.md');
    const { code, stderr } = await runCli(fs, [
      '--workspace', 'todo.md', 'update-subtask', '--project', 'Website Redesign', '--column', '1', '--index', '0', '--subtask', '0',
    ]);
    expect(code).not.toBe(0);
    expect(stderr.join('\n')).toContain('Nothing to update');
    expect(await fs.read('todo.md')).toBe(before);
  });

  test('update with an empty --text is rejected rather than blanking the task', async () => {
    const before = await fs.read('todo.md');
    const { code, stderr } = await runCli(fs, ['--workspace', 'todo.md', 'update', '--project', 'Errands', '--index', '0', '--text', '']);
    expect(code).not.toBe(0);
    expect(stderr.join('\n')).toContain('must not be empty');
    expect(await fs.read('todo.md')).toBe(before);
  });

  test('add --text creates a task from the flag', async () => {
    const { code } = await runCli(fs, ['--workspace', 'todo.md', 'add', '--project', 'Errands', '--text', 'Flag task']);
    expect(code).toBe(0);
    expect(await fs.read('todo.md')).toContain('Flag task');
  });

  test('update with no change flags is a usage error, not a silent no-op', async () => {
    const before = await fs.read('todo.md');
    const { code, stderr } = await runCli(fs, ['--workspace', 'todo.md', 'update', '--project', 'Errands', '--index', '0']);
    expect(code).not.toBe(0);
    expect(stderr.join('\n')).toContain('Nothing to update');
    expect(await fs.read('todo.md')).toBe(before);
  });

  test('project-add appends a new project heading', async () => {
    const { code } = await runCli(fs, ['--workspace', 'todo.md', 'project-add', 'New Project', '--layout', 'checklist']);
    expect(code).toBe(0);
    expect(await fs.read('todo.md')).toContain('# New Project');
  });

  test('rm removes a task from the file', async () => {
    const { code } = await runCli(fs, ['--workspace', 'todo.md', 'rm', '--project', 'Errands', '--index', '0']);
    expect(code).toBe(0);
    expect(await fs.read('todo.md')).not.toContain('Buy groceries');
  });

  test('a bad location surfaces the operation error and does not write', async () => {
    const before = await fs.read('todo.md');
    const { code, stdout } = await runCli(fs, ['--workspace', 'todo.md', 'rm', '--project', 'Errands', '--index', '999']);
    expect(code).toBe(2);
    expect(stdout.join('\n')).toContain('TASK_NOT_FOUND');
    expect(await fs.read('todo.md')).toBe(before);
  });
});

describe('mutation commands — directory mode (spec/corpus/directory-mode/)', () => {
  let fs: InMemoryFileSystem;

  beforeEach(async () => {
    fs = new InMemoryFileSystem();
    await seedDirectoryModeFixture(fs, 'workspace');
  });

  test('done marks the task complete and appends an actual-time token, only to its own file', async () => {
    const { code } = await runCli(fs, [
      '--workspace', 'workspace', 'done', '--project', 'Reading List', '--index', '0',
    ]);
    expect(code).toBe(0);
    const content = await fs.read('workspace/reading-list.md');
    expect(content).toContain('- [x] Deep Work');
    expect(content).toMatch(/&\(\d{4}-\d{2}-\d{2}\)/);
    // Untouched sibling files stay byte-identical to the fixture.
    expect(await fs.read('workspace/inbox.md')).toBe(loadCorpusFile('directory-mode/inbox'));
  });

  // Regression: rebuildBlocks used to reattach a mutated task's preceding
  // content only by reference identity or `^id`. Every task in this fixture
  // has neither, so `done` used to hoist both tasks above the frontmatter,
  // heading, and prose, and re-emit the description below them.
  test('done on a task with no ^id changes only that task\'s line, leaving every other line in place', async () => {
    const before = await fs.read('workspace/reading-list.md');
    const { code } = await runCli(fs, [
      '--workspace', 'workspace', 'done', '--project', 'Reading List', '--index', '0',
    ]);
    expect(code).toBe(0);
    const after = await fs.read('workspace/reading-list.md');

    const beforeLines = before.split('\n');
    const afterLines = after.split('\n');
    expect(afterLines).toHaveLength(beforeLines.length);

    const changedIndices = beforeLines
      .map((line, i) => (line === afterLines[i] ? -1 : i))
      .filter(i => i !== -1);
    expect(changedIndices).toEqual([beforeLines.indexOf('- [ ] Deep Work ~6hrs #genre/productivity')]);
    expect(afterLines[changedIndices[0]]).toMatch(/^- \[x\] Deep Work ~6hrs &\(\d{4}-\d{2}-\d{2}\) #genre\/productivity$/);
  });

  test('done --actual records the actual duration on the completion token', async () => {
    const { code } = await runCli(fs, [
      '--workspace', 'workspace', 'done', '--project', 'Reading List', '--index', '0', '--actual', '3hrs',
    ]);
    expect(code).toBe(0);
    const content = await fs.read('workspace/reading-list.md');
    expect(content).toMatch(/&\(\d{4}-\d{2}-\d{2}\):3hrs/);
  });

  test('done --actual rejects a malformed duration with the same message shape as --effort', async () => {
    const { code, stderr } = await runCli(fs, [
      '--workspace', 'workspace', 'done', '--project', 'Reading List', '--index', '0', '--actual', 'bogus',
    ]);
    expect(code).toBe(1);
    expect(stderr.join('\n')).toContain("Invalid --actual 'bogus'");
  });

  test('move relocates a task between kanban columns in the same project file', async () => {
    // columns: [Next, Later, Waiting, Done] makes column 0 = Next (holds
    // "Wireframe landing page") and column 1 = Later (holds "Competitive
    // analysis") — declared column order, not document order.
    const { code } = await runCli(fs, [
      '--workspace', 'workspace',
      'move', '--project', 'Website Redesign', '--index', '0', '--column', '1',
      '--to-project', 'Website Redesign', '--to-index', '0', '--to-column', '0',
    ]);
    expect(code).toBe(0);
    const content = await fs.read('workspace/website-redesign.md');
    const laterSection = content.split('## Later')[1]?.split('## ')[0] ?? '';
    const nextSection = content.split('## Next')[1]?.split('## ')[0] ?? '';
    expect(laterSection).not.toContain('Competitive analysis');
    expect(nextSection).toContain('Competitive analysis');
    expect(nextSection).toContain('Wireframe landing page');
  });

  test('project-add creates a new project file, slugified from the given name', async () => {
    const { code } = await runCli(fs, ['--workspace', 'workspace', 'project-add', 'Groceries', '--layout', 'checklist']);
    expect(code).toBe(0);
    await expect(fs.stat('workspace/groceries.md')).resolves.toBeDefined();

    // The file carries the marker and a `title`, so the name survives a
    // reload even though the slug differs from it.
    expect(await fs.read('workspace/groceries.md')).toContain('markdone: 2');
    const { code: listCode, stdout } = await runCli(fs, [
      '--workspace', 'workspace', '--json', 'list', '--project', 'Groceries',
    ]);
    expect(listCode).toBe(0);
    expect(JSON.parse(stdout.join('\n'))).toEqual([]);
  });

  test('project-add --folder creates <slug>/todo.md, addressable by path', async () => {
    const { code } = await runCli(fs, [
      '--workspace', 'workspace', 'project-add', 'Home Network', '--layout', 'checklist', '--folder',
    ]);
    expect(code).toBe(0);
    expect(await fs.read('workspace/home-network/todo.md')).toContain('markdone: 2');
    const { code: listCode } = await runCli(fs, [
      '--workspace', 'workspace', '--json', 'list', '--project', 'home-network/todo',
    ]);
    expect(listCode).toBe(0);
  });

  test('a project name shared by several projects is ambiguous and must be addressed by path', async () => {
    await fs.write('workspace/a.md', '---\nmarkdone: 2\ntitle: Shared\n---\n');
    await fs.write('workspace/b/todo.md', '---\nmarkdone: 2\ntitle: Shared\n---\n');
    const byName = await runCli(fs, ['--workspace', 'workspace', 'list', '--project', 'Shared']);
    expect(byName.code).toBe(1);
    expect(byName.stderr.join('\n')).toContain('ambiguous (a.md, b/todo.md)');
    const byPath = await runCli(fs, ['--workspace', 'workspace', 'list', '--project', 'b/todo']);
    expect(byPath.code).toBe(0);
  });

  test('column-add adds a new column to a kanban project', async () => {
    const { code } = await runCli(fs, [
      '--workspace', 'workspace', 'column-add', 'Blocked', '--project', 'Website Redesign',
    ]);
    expect(code).toBe(0);
    const content = await fs.read('workspace/website-redesign.md');
    // Parse back rather than pattern-matching the raw frontmatter text: the
    // `yaml` library re-dumps an edited array in block style, not the
    // source's flow style, so the written bytes for `columns:` aren't a
    // fixed string.
    const { project } = parseProject(content, { filenameFallback: 'website-redesign' });
    expect(project.layout).toBe('kanban');
    if (project.layout === 'kanban') {
      expect(project.columnOrder).toEqual(['Next', 'Later', 'Waiting', 'Done', 'Blocked']);
    }
  });

  test('--dry-run on a directory-mode mutation reports the change without writing any file', async () => {
    const before = await fs.read('workspace/website-redesign.md');
    const { code, stdout } = await runCli(fs, [
      '--workspace', 'workspace', 'done', '--project', 'Website Redesign', '--index', '0', '--column', '0', '--dry-run',
    ]);
    expect(code).toBe(0);
    expect(stdout.join('\n')).toContain('---');
    expect(await fs.read('workspace/website-redesign.md')).toBe(before);
  });

  test('project-add --folder in a single-file workspace is rejected, not ignored', async () => {
    const single = new InMemoryFileSystem();
    await seedFileModeFixture(single, 'file-mode', 'todo.md');
    const { code, stderr } = await runCli(single, [
      '--workspace', 'todo.md', 'project-add', 'Garden', '--layout', 'checklist', '--folder',
    ]);
    expect(code).toBe(1);
    expect(stderr.join('\n')).toContain('directory workspaces only');
  });

  test('a digit-only locator is an index, even when a project is named that', async () => {
    await fs.write('workspace/2024.md', '---\nmarkdone: 2\n---\n- [ ] yearly review ^yr1\n');
    const byIndex = await runCli(fs, ['--workspace', 'workspace', '--json', 'list', '--project', '2024']);
    // Out of range as an index here, so it does not resolve — the digit
    // branch claims it. Address such a project by its path-qualified name.
    expect(byIndex.code).toBe(1);
  });

  test('cancel marks a task cancelled and applies the on-complete rule', async () => {
    await fs.write(
      'workspace/board.md',
      '---\nmarkdone: 2\nlayout: kanban\ncolumns: [Todo, Done]\n---\n## Todo\n\n- [ ] Ship it ^s1\n\n## Done\n',
    );
    const { code } = await runCli(fs, ['--workspace', 'workspace', 'cancel', '--task', 's1']);
    expect(code).toBe(0);
    const content = await fs.read('workspace/board.md');
    expect(content).toContain('## Done\n- [-] Ship it');
    expect(content).not.toContain('&(');
  });

  test('cancel by --project/--index', async () => {
    await fs.write('workspace/list.md', '---\nmarkdone: 2\n---\n- [ ] Drop me\n');
    const { code } = await runCli(fs, ['--workspace', 'workspace', 'cancel', '--project', 'list', '--index', '0']);
    expect(code).toBe(0);
    expect(await fs.read('workspace/list.md')).toContain('- [-] Drop me');
  });
});
