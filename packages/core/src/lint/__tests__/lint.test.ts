// Unit coverage for lint at its new home in core. Moved here from
// packages/cli/src/lint.ts so both `markdone lint` and the Obsidian
// plugin's lint command report identical findings from the same rules —
// the CLI's own lint.test.ts (exercised through `runCli`) is the check that
// the move preserved behavior; this file checks the module standalone,
// with no CLI in the loop.
import { InMemoryFileSystem } from '../../storage/inMemoryFileSystem';
import { resolveWorkspaces, buildQueryState } from '../../storage/resolveWorkspaces';
import { lintWorkspaces, hasBlockingFindings, effectiveSeverity } from '../lint';

async function lint(fs: InMemoryFileSystem, path = 'workspace') {
  const resolved = await resolveWorkspaces([{ path }], fs, {});
  const state = buildQueryState(resolved);
  return lintWorkspaces(resolved, state, fs);
}

describe('lintWorkspaces', () => {
  test('a clean workspace has no findings', async () => {
    const fs = new InMemoryFileSystem();
    await fs.write('workspace/inbox.md', '---\nmarkdone: 2\n---\n');
    const findings = await lint(fs);
    expect(findings).toEqual([]);
  });

  test('flags an open task with no ^id at info severity', async () => {
    const fs = new InMemoryFileSystem();
    await fs.write('todo.md', ['---', 'markdone: 2', '---', '# Inbox', '', '- [ ] Buy milk'].join('\n'));
    const findings = await lint(fs, 'todo.md');
    expect(findings).toEqual([
      expect.objectContaining({ severity: 'info', message: expect.stringContaining('Open task with no ^id') }),
    ]);
  });

  test('detects a duplicate ^id across tasks in the same workspace', async () => {
    const fs = new InMemoryFileSystem();
    await fs.write('todo.md', ['# Inbox', '', '- [ ] First task ^dup', '- [ ] Second task ^dup'].join('\n'));
    const findings = await lint(fs, 'todo.md');
    expect(findings).toContainEqual(expect.objectContaining({ severity: 'error', message: expect.stringContaining('Duplicate ^dup') }));
  });

  test('detects a #after/ reference to an unknown id', async () => {
    const fs = new InMemoryFileSystem();
    await fs.write('todo.md', ['# Inbox', '', '- [ ] Blocked task #after/ghost'].join('\n'));
    const findings = await lint(fs, 'todo.md');
    expect(findings).toContainEqual(expect.objectContaining({ severity: 'error', message: expect.stringContaining('unknown ^ghost') }));
  });

  test('deprecated v1 syntax surfaces as an info-severity parser warning', async () => {
    const fs = new InMemoryFileSystem();
    await fs.write('todo.md', ['# Inbox', '', '- [ ] Old style *2hrs'].join('\n'));
    const findings = await lint(fs, 'todo.md');
    expect(findings).toContainEqual(expect.objectContaining({ severity: 'info', message: expect.stringContaining('Deprecated') }));
  });

  test('flags an invalid recognized key in _markdone.md', async () => {
    const fs = new InMemoryFileSystem();
    await fs.write('workspace/inbox.md', '');
    await fs.write('workspace/_markdone.md', ['---', 'owner: alice', 'layout: not-a-real-layout', '---', ''].join('\n'));
    const findings = await lint(fs);
    expect(findings).toContainEqual(
      expect.objectContaining({ severity: 'error', message: expect.stringContaining("Invalid value for 'layout:'") }),
    );
  });

  test('flags an unrecognized key in _markdone.md at info severity', async () => {
    const fs = new InMemoryFileSystem();
    await fs.write('workspace/inbox.md', '');
    await fs.write('workspace/_markdone.md', ['---', 'owner: alice', 'sprintLength: 2w', '---', ''].join('\n'));
    const findings = await lint(fs);
    expect(findings).toContainEqual(
      expect.objectContaining({ severity: 'info', message: expect.stringContaining("Unrecognized key 'sprintLength:'") }),
    );
  });
});

describe('effectiveSeverity / hasBlockingFindings', () => {
  test('--strict promotes info to warn, which is blocking', () => {
    const finding = { severity: 'info' as const, message: 'x' };
    expect(effectiveSeverity(finding, false)).toBe('info');
    expect(effectiveSeverity(finding, true)).toBe('warn');
    expect(hasBlockingFindings([finding], false)).toBe(false);
    expect(hasBlockingFindings([finding], true)).toBe(true);
  });

  test('an error finding is always blocking', () => {
    const finding = { severity: 'error' as const, message: 'x' };
    expect(hasBlockingFindings([finding], false)).toBe(true);
  });

  describe('marker and discovery findings', () => {
    const MARKED = '---\nmarkdone: 2\n---\n';

    test('an unsupported marker is an error (report only)', async () => {
      const fs = new InMemoryFileSystem();
      await fs.write('workspace/inbox.md', MARKED);
      await fs.write('workspace/future.md', '---\nmarkdone: 3\n---\n');
      const findings = await lint(fs);
      const f = findings.find(x => x.path === 'future.md');
      expect(f).toMatchObject({ severity: 'error' });
      expect(f?.fix).toBeUndefined();
      // Reported once, as a structured finding — not again as a load warning.
      expect(findings.filter(x => x.path === 'future.md')).toHaveLength(1);
    });

    test('an unmarked root inbox.md is a warning whose fix adds the marker', async () => {
      const fs = new InMemoryFileSystem();
      await fs.write('workspace/inbox.md', '- [ ] capture\n');
      const findings = await lint(fs);
      const f = findings.find(x => x.path === 'inbox.md');
      expect(f).toMatchObject({ severity: 'warn' });
      expect(f?.fix?.after).toBe('---\nmarkdone: 2\n---\n- [ ] capture\n');
    });

    test('an unmarked note that looks like a task file is an info hint with a fix; plain checkboxes are not reported', async () => {
      const fs = new InMemoryFileSystem();
      await fs.write('workspace/inbox.md', MARKED);
      await fs.write('workspace/real.md', MARKED);
      await fs.write('workspace/plan.md', '---\nlayout: kanban\n---\n## Next\n');
      await fs.write('workspace/tokens.md', '- [ ] call !2026-05-01\n');
      await fs.write('workspace/plain.md', '- [ ] one\n- [x] two\n');
      const findings = await lint(fs);
      expect(findings.find(x => x.path === 'plan.md')).toMatchObject({ severity: 'info' });
      expect(findings.find(x => x.path === 'plan.md')?.fix?.after?.startsWith('---\nmarkdone: 2\nlayout: kanban\n---')).toBe(true);
      expect(findings.find(x => x.path === 'tokens.md')?.fix).toBeDefined();
      expect(findings.some(x => x.path === 'plain.md')).toBe(false);
    });

    test('a workspace with .md files and no marked project carries the migration step', async () => {
      const fs = new InMemoryFileSystem();
      await fs.write('workspace/inbox.md', MARKED);
      await fs.write('workspace/old.md', '- [ ] x\n');
      const findings = await lint(fs);
      expect(findings).toContainEqual(
        expect.objectContaining({ severity: 'warn', message: expect.stringContaining("Add 'markdone: 2'") }),
      );
    });

    test('two projects with the same name', async () => {
      const fs = new InMemoryFileSystem();
      await fs.write('workspace/inbox.md', MARKED);
      await fs.write('workspace/home.md', MARKED);
      await fs.write('workspace/home/todo.md', MARKED);
      const findings = await lint(fs);
      expect(findings).toContainEqual(
        expect.objectContaining({ severity: 'error', message: expect.stringContaining('home.md, home/todo.md') }),
      );
    });

    test('a projects: entry matching no marked file', async () => {
      const fs = new InMemoryFileSystem();
      await fs.write('workspace/inbox.md', MARKED);
      await fs.write('workspace/_markdone.md', '---\nprojects: [ghost]\n---\n');
      const findings = await lint(fs);
      expect(findings).toContainEqual(expect.objectContaining({ severity: 'warn', message: expect.stringContaining("'ghost'") }));
    });

    test('file mode: a missing marker is reported with a fix', async () => {
      const fs = new InMemoryFileSystem();
      await fs.write('todo.md', '# Inbox\n');
      const findings = await lint(fs, 'todo.md');
      expect(findings.find(x => x.fix)?.fix?.after).toBe('---\nmarkdone: 2\n---\n# Inbox\n');
    });
  });

  describe('on-complete findings', () => {
    const board = (extra: string, body: string) =>
      `---\nmarkdone: 2\nlayout: kanban\ncolumns: [Todo, Done]\n${extra}---\n${body}`;

    test('on-complete naming a column that is not in columns is an error', async () => {
      const fs = new InMemoryFileSystem();
      await fs.write('workspace/inbox.md', '---\nmarkdone: 2\n---\n');
      await fs.write('workspace/b.md', board('on-complete: Archive\n', '## Todo\n\n## Done\n'));
      const findings = await lint(fs);
      expect(findings).toContainEqual(expect.objectContaining({ severity: 'error', message: expect.stringContaining("'Archive'") }));
    });

    test('a completed task outside the on-complete column gets a moveTask proposal', async () => {
      const fs = new InMemoryFileSystem();
      await fs.write('workspace/inbox.md', '---\nmarkdone: 2\n---\n');
      await fs.write('workspace/b.md', board('', '## Todo\n\n- [x] Finished ^t1\n\n## Done\n'));
      const findings = await lint(fs);
      const f = findings.find(x => x.proposal);
      expect(f).toMatchObject({ severity: 'info', proposal: { operation: 'moveTask' } });
      expect(f?.proposal?.input).toMatchObject({ from: { taskId: 't1' }, to: { columnIndex: 1, taskIndex: 0 } });
    });

    test('on-complete: none suppresses the proposal', async () => {
      const fs = new InMemoryFileSystem();
      await fs.write('workspace/inbox.md', '---\nmarkdone: 2\n---\n');
      await fs.write('workspace/b.md', board('on-complete: none\n', '## Todo\n\n- [x] Finished ^t1\n\n## Done\n'));
      const findings = await lint(fs);
      expect(findings.some(x => x.proposal)).toBe(false);
    });
  });
});
