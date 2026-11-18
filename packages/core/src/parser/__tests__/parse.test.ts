import { parse, _resetIdCounter } from '../parse';
import { serialize } from '../serialize';
import { addMarkerToContent } from '../frontmatter';
import { getTasks, getColumns, getColumnTasks, getDescription } from '../../model/accessors';
import type { Task, Project, ChecklistProject } from '../../model/types';

beforeEach(() => {
  _resetIdCounter();
});

function checklistProjects(projects: Project[]): ChecklistProject[] {
  return projects.filter((p): p is ChecklistProject => p.layout === 'checklist');
}

// Helper to get first task from the first checklist project that has tasks.
// ensureInbox may inject an empty Inbox project at index 0; this skips it.
function firstTask(md: string): Task {
  const { file } = parse(md);
  const proj = checklistProjects(file.projects).find(p => getTasks(p).length > 0)!;
  return getTasks(proj)[0];
}

// ---- Basic structure ----

describe('parse - basic structure', () => {
  test('preamble before first H1 is preserved (not a project)', () => {
    const md = `Some preamble text\n\n# My Project\n\n- [ ] Task one\n`;
    const { file } = parse(md);
    // ensureInbox injects Inbox at index 0; user project follows
    expect(file.projects).toHaveLength(2);
    expect(file.projects[1].name).toBe('My Project');
    expect(file.preamble.map(b => (b.type === 'opaque' ? b.raw : '')).join('\n')).toContain('Some preamble text');
  });

  test('multiple H1 headings create multiple projects', () => {
    const md = `# Project A\n\n- [ ] Task A\n\n# Project B\n\n- [ ] Task B\n`;
    const { file } = parse(md);
    expect(file.projects).toHaveLength(3);
    expect(file.projects[1].name).toBe('Project A');
    expect(file.projects[2].name).toBe('Project B');
  });

  test('empty project (no tasks, no columns)', () => {
    const md = `# Empty Project\n`;
    const { file } = parse(md);
    expect(file.projects).toHaveLength(2);
    const proj = checklistProjects(file.projects)[1];
    expect(proj.layout).toBe('checklist');
    expect(getTasks(proj)).toHaveLength(0);
  });
});

// ---- Checklist vs Kanban ----

describe('parse - project layout detection (file mode: v1-compatible any-H2 inference)', () => {
  test('no H2s → checklist layout', () => {
    const md = `# My List\n\n- [ ] Task one\n- [x] Task two\n`;
    const proj = parse(md).file.projects[1]; // index 0 is Inbox
    expect(proj.layout).toBe('checklist');
    if (proj.layout === 'checklist') {
      expect(getTasks(proj)).toHaveLength(2);
    }
  });

  test('H2s present → kanban layout', () => {
    const md = `# My Board\n\n## Todo\n\n- [ ] Task A\n\n## Done\n\n- [x] Task B\n`;
    const proj = parse(md).file.projects[1]; // index 0 is Inbox
    expect(proj.layout).toBe('kanban');
    if (proj.layout === 'kanban') {
      const columns = getColumns(proj);
      expect(columns).toHaveLength(2);
      expect(columns[0].name).toBe('Todo');
      expect(getColumnTasks(columns[0])).toHaveLength(1);
      expect(columns[1].name).toBe('Done');
      expect(getColumnTasks(columns[1])).toHaveLength(1);
    }
  });

  test('empty kanban column (any-H2 mode keeps empty H2s as columns)', () => {
    const md = `# Board\n\n## Backlog\n\n## In Progress\n\n- [ ] Task\n`;
    const proj = parse(md).file.projects[1]; // index 0 is Inbox
    expect(proj.layout).toBe('kanban');
    if (proj.layout === 'kanban') {
      const columns = getColumns(proj);
      expect(getColumnTasks(columns[0])).toHaveLength(0);
      expect(getColumnTasks(columns[1])).toHaveLength(1);
    }
  });
});

// ---- Project description ----

describe('parse - project description', () => {
  test('text between H1 and first task is description', () => {
    const md = `# My Project\n\nThis is the project description.\n\n- [ ] First task\n`;
    const proj = parse(md).file.projects[1]; // index 0 is Inbox
    expect(getDescription(proj)).toBe('This is the project description.');
  });

  test('text between H1 and first H2 is description (kanban)', () => {
    const md = `# My Board\n\nBoard description here.\n\n## Todo\n\n- [ ] Task\n`;
    const proj = parse(md).file.projects[1]; // index 0 is Inbox
    expect(getDescription(proj)).toBe('Board description here.');
  });

  test('no description when first line is a task', () => {
    const md = `# My Project\n\n- [ ] Task\n`;
    const proj = parse(md).file.projects[1]; // index 0 is Inbox
    expect(getDescription(proj)).toBeUndefined();
  });
});

// ---- Task tokens ----

describe('parse - due date token (!)', () => {
  test('parses !date token', () => {
    const task = firstTask(`# P\n\n- [ ] Buy milk !2025-12-01\n`);
    expect(task.dueDate).toBe('2025-12-01');
    expect(task.text).toBe('Buy milk');
  });

  test('duplicate ! tokens use last one', () => {
    const task = firstTask(`# P\n\n- [ ] Task !2025-01-01 !2025-12-31\n`);
    expect(task.dueDate).toBe('2025-12-31');
  });

  test('invalid date shape stays as description text', () => {
    const task = firstTask(`# P\n\n- [ ] Task !04-20-2026\n`);
    expect(task.dueDate).toBeUndefined();
    expect(task.text).toContain('!04-20-2026');
  });
});

describe('parse - defer date token (>)', () => {
  test('parses >date token', () => {
    const task = firstTask(`# P\n\n- [ ] Task >2026-04-01\n`);
    expect(task.deferDate).toBe('2026-04-01');
  });
});

describe('parse - context token (@)', () => {
  test('parses @context token', () => {
    const task = firstTask(`# P\n\n- [ ] Call someone @phone\n`);
    expect(task.contexts).toEqual(['phone']);
  });

  test('multiple @context tokens', () => {
    const task = firstTask(`# P\n\n- [ ] Task @home @computer\n`);
    expect(task.contexts).toEqual(['home', 'computer']);
  });

  test('@word inside email address is NOT parsed as context', () => {
    const task = firstTask(`# P\n\n- [ ] Email alex@work.com about project\n`);
    expect(task.contexts).toHaveLength(0);
    expect(task.text).toContain('alex@work.com');
  });

  test('@waiting is deprecated, rewritten to #waiting/unknown', () => {
    const task = firstTask(`# P\n\n- [ ] Task @waiting\n`);
    expect(task.contexts).toHaveLength(0);
    expect(task.tags).toContainEqual({ type: 'nested', key: 'waiting', value: 'unknown' });
  });
});

describe('parse - value token ($)', () => {
  test('parses $value token', () => {
    const task = firstTask(`# P\n\n- [ ] High value task $5\n`);
    expect(task.value).toBe(5);
    expect(task.text).toBe('High value task');
  });
});

describe('parse - complexity token (%)', () => {
  test('parses %complexity token', () => {
    const task = firstTask(`# P\n\n- [ ] Complex task %3\n`);
    expect(task.complexity).toBe(3);
  });
});

describe('parse - effort token (~)', () => {
  test('parses ~effort with min unit', () => {
    const task = firstTask(`# P\n\n- [ ] Quick task ~30min\n`);
    expect(task.effort).toEqual({ amount: 30, unit: 'min' });
  });

  test('parses ~effort with hrs unit', () => {
    const task = firstTask(`# P\n\n- [ ] Long task ~2hrs\n`);
    expect(task.effort).toEqual({ amount: 2, unit: 'hrs' });
  });

  test('parses ~effort with days unit', () => {
    const task = firstTask(`# P\n\n- [ ] Multi-day task ~3days\n`);
    expect(task.effort).toEqual({ amount: 3, unit: 'days' });
  });

  test('parses ~effort with wks unit', () => {
    const task = firstTask(`# P\n\n- [ ] Week task ~1wks\n`);
    expect(task.effort).toEqual({ amount: 1, unit: 'wks' });
  });

  test('bare ~number with no unit stays as description text', () => {
    const task = firstTask(`# P\n\n- [ ] Task ~3\n`);
    expect(task.effort).toBeUndefined();
    expect(task.text).toContain('~3');
  });

  test('duplicate ~ tokens use last one', () => {
    const task = firstTask(`# P\n\n- [ ] Task ~1hrs ~2hrs\n`);
    expect(task.effort).toEqual({ amount: 2, unit: 'hrs' });
  });

  test('deprecated *effort still parses, rewritten to ~ on save', () => {
    const task = firstTask(`# P\n\n- [ ] Quick task *30min\n`);
    expect(task.effort).toEqual({ amount: 30, unit: 'min' });
    expect(serialize(parse(`# P\n\n- [ ] Quick task *30min\n`).file)).toContain('~30min');
  });
});

describe('parse - actual token (&)', () => {
  test('&(date) — completed date only', () => {
    const task = firstTask(`# P\n\n- [x] Done task &(2025-11-01)\n`);
    expect(task.actual).toEqual({ completionDate: '2025-11-01' });
  });

  test('&(date):duration — completed date with duration', () => {
    const task = firstTask(`# P\n\n- [x] Done task &(2025-11-01):2hrs\n`);
    expect(task.actual).toEqual({
      completionDate: '2025-11-01',
      duration: { amount: 2, unit: 'hrs' },
    });
  });

  test('&(start, end) — date range', () => {
    const task = firstTask(`# P\n\n- [x] Done task &(2025-10-01, 2025-11-01)\n`);
    expect(task.actual).toEqual({
      completionDate: '2025-11-01',
      startDate: '2025-10-01',
    });
  });

  test('&(start, end):duration — date range with duration', () => {
    const task = firstTask(`# P\n\n- [x] Done task &(2025-10-01, 2025-11-01):3days\n`);
    expect(task.actual).toEqual({
      completionDate: '2025-11-01',
      startDate: '2025-10-01',
      duration: { amount: 3, unit: 'days' },
    });
  });

  test('duplicate & tokens use last one', () => {
    const task = firstTask(`# P\n\n- [x] Done &(2025-01-01) &(2025-12-31)\n`);
    expect(task.actual?.completionDate).toBe('2025-12-31');
  });

  test('more than two dates is invalid, stays as text', () => {
    const task = firstTask(`# P\n\n- [x] Done &(2025-01-01, 2025-02-01, 2025-03-01)\n`);
    expect(task.actual).toBeUndefined();
    expect(task.text).toContain('&(2025-01-01, 2025-02-01, 2025-03-01)');
  });
});

describe('parse - tag tokens (#)', () => {
  test('parses label tag', () => {
    const task = firstTask(`# P\n\n- [ ] Task #urgent\n`);
    expect(task.tags).toEqual([{ type: 'label', name: 'urgent' }]);
  });

  test('parses nested tag (#key/value)', () => {
    const task = firstTask(`# P\n\n- [ ] Task #priority/high\n`);
    expect(task.tags).toEqual([{ type: 'nested', key: 'priority', value: 'high' }]);
  });

  test('deprecated #key(value) still parses as a nested tag, rewritten on save', () => {
    const task = firstTask(`# P\n\n- [ ] Task #priority(high)\n`);
    expect(task.tags).toEqual([{ type: 'nested', key: 'priority', value: 'high' }]);
    expect(serialize(parse(`# P\n\n- [ ] Task #priority(high)\n`).file)).toContain('#priority/high');
  });

  test('multiple tags on single task', () => {
    const task = firstTask(`# P\n\n- [ ] Task #urgent #priority/high #review\n`);
    expect(task.tags).toHaveLength(3);
    expect(task.tags[0]).toEqual({ type: 'label', name: 'urgent' });
    expect(task.tags[1]).toEqual({ type: 'nested', key: 'priority', value: 'high' });
    expect(task.tags[2]).toEqual({ type: 'label', name: 'review' });
  });

  test('#number (e.g. PR #42) is NOT a tag (must contain a non-digit)', () => {
    const task = firstTask(`# P\n\n- [ ] Code review: PR #42 @computer\n`);
    expect(task.tags).toHaveLength(0);
    expect(task.text).toBe('Code review: PR #42');
  });
});

// ---- Block ID (^id) ----

describe('parse - block id (^)', () => {
  test('parses a trailing ^id', () => {
    const task = firstTask(`# P\n\n- [ ] Task ^my-id\n`);
    expect(task.blockId).toBe('my-id');
    expect(task.text).toBe('Task');
  });

  test('^id not at the end of the line is not recognized', () => {
    const task = firstTask(`# P\n\n- [ ] Task ^my-id more text\n`);
    expect(task.blockId).toBeUndefined();
    expect(task.text).toContain('^my-id');
  });
});

// ---- Wikilinks, embeds, inline code ----

describe('parse - protected spans (wikilinks, embeds, inline code)', () => {
  test('wikilink content is not scanned for tokens', () => {
    const task = firstTask(`# P\n\n- [ ] See [[Deploy Notes#Environment]] $5\n`);
    expect(task.value).toBe(5);
    expect(task.text).toBe('See [[Deploy Notes#Environment]]');
  });

  test('inline code content is not scanned for tokens', () => {
    const task = firstTask('# P\n\n- [ ] Fix the `$PATH` handling\n');
    expect(task.value).toBeUndefined();
    expect(task.text).toBe('Fix the `$PATH` handling');
  });

  test('embed content is not scanned for tokens', () => {
    const task = firstTask(`# P\n\n- [ ] See ![[chart.png]] #research\n`);
    expect(task.tags).toEqual([{ type: 'label', name: 'research' }]);
    expect(task.text).toBe('See ![[chart.png]]');
  });
});

// ---- Escaping ----

describe('parse - escaping (\\$)', () => {
  test('\\$ is unescaped to a literal $ in description text', () => {
    const task = firstTask(`# P\n\n- [ ] Costs \\$5 total\n`);
    expect(task.value).toBeUndefined();
    expect(task.text).toBe('Costs $5 total');
  });
});

// ---- Checkbox states ----

describe('parse - checkbox states', () => {
  test('[x] marks task as completed', () => {
    const task = firstTask(`# P\n\n- [x] Done\n`);
    expect(task.completed).toBe(true);
    expect(task.checkbox).toEqual({ state: 'done', marker: 'x' });
  });

  test('[ ] marks task as incomplete', () => {
    const task = firstTask(`# P\n\n- [ ] Todo\n`);
    expect(task.completed).toBe(false);
    expect(task.checkbox).toEqual({ state: 'open', marker: ' ' });
  });

  test('[X] uppercase marks task as completed, normalized to lowercase', () => {
    const task = firstTask(`# P\n\n- [X] Done\n`);
    expect(task.completed).toBe(true);
    expect(task.checkbox.marker).toBe('x');
  });

  test('[-] marks task as cancelled', () => {
    const task = firstTask(`# P\n\n- [-] Abandoned\n`);
    expect(task.completed).toBe(false);
    expect(task.checkbox).toEqual({ state: 'cancelled', marker: '-' });
  });

  test('an unrecognized marker is preserved as "other"', () => {
    const task = firstTask(`# P\n\n- [/] In progress\n`);
    expect(task.checkbox).toEqual({ state: 'other', marker: '/' });
  });
});

// ---- Subtasks ----

describe('parse - subtasks', () => {
  test('parses one level of subtasks', () => {
    const md = `# P\n\n- [ ] Parent task\n  - [ ] Subtask one\n  - [x] Subtask two\n`;
    const proj = checklistProjects(parse(md).file.projects)[1]; // index 0 is Inbox
    const tasks = getTasks(proj);
    expect(tasks).toHaveLength(1);
    expect(tasks[0].subtasks).toHaveLength(2);
    expect(tasks[0].subtasks[0].text).toBe('Subtask one');
    expect(tasks[0].subtasks[1].completed).toBe(true);
  });

  test('completed parent task', () => {
    const md = `# P\n\n- [x] Done parent\n  - [x] Done subtask\n`;
    const proj = checklistProjects(parse(md).file.projects)[1]; // index 0 is Inbox
    const tasks = getTasks(proj);
    expect(tasks[0].completed).toBe(true);
    expect(tasks[0].subtasks[0].completed).toBe(true);
  });

  test('tokens inside subtasks are parsed correctly', () => {
    const md = `# P\n\n- [ ] Parent\n  - [ ] Subtask !2025-12-01 @home\n`;
    const proj = checklistProjects(parse(md).file.projects)[1]; // index 0 is Inbox
    const subtask = getTasks(proj)[0].subtasks[0];
    expect(subtask.text).toBe('Subtask');
    expect(subtask.dueDate).toBe('2025-12-01');
    expect(subtask.contexts).toEqual(['home']);
  });
});

// ---- Content preservation ----

describe('parse - content preservation', () => {
  test('prose between tasks is preserved as opaque content, not dropped', () => {
    const md = `# P\n\n- [ ] Task one\n\nSome unrelated note.\n\n- [ ] Task two\n`;
    const proj = checklistProjects(parse(md).file.projects)[1];
    expect(getTasks(proj)).toHaveLength(2);
    const raw = proj.blocks.filter(b => b.type === 'opaque').map(b => (b as { raw: string }).raw);
    expect(raw.join('\n')).toContain('Some unrelated note.');
  });

  test('a kanban Inbox is reported as an error but its content is preserved, not destroyed', () => {
    const md = `# Inbox\n\n## Todo\n\n- [ ] Kept task\n`;
    const { file, warnings } = parse(md);
    expect(file.projects[0].layout).toBe('kanban');
    expect(warnings.some(w => w.includes('Inbox'))).toBe(true);
    if (file.projects[0].layout === 'kanban') {
      expect(getColumnTasks(getColumns(file.projects[0])[0])).toHaveLength(1);
    }
  });
});

// ---- Malformed input ----

describe('parse - malformed input', () => {
  test('does not throw on empty string', () => {
    expect(() => parse('')).not.toThrow();
  });

  test('does not throw on string with no H1', () => {
    expect(() => parse('some random text\n- [ ] task')).not.toThrow();
  });

  test('does not throw on deeply malformed task', () => {
    expect(() => parse('# P\n\n- [ ] Task !!!! ### @@@\n')).not.toThrow();
  });

  test('does not throw on unclosed tokens', () => {
    expect(() => parse('# P\n\n- [ ] Task &(unclosed\n')).not.toThrow();
  });

  test('returns only the Inbox project for empty input', () => {
    // ensureInbox always injects an Inbox project even for empty input
    expect(parse('').file.projects).toHaveLength(1);
    expect(parse('').file.projects[0].name).toBe('Inbox');
  });
});

// ---- Round-trip tests ----

describe('round-trip: parse → serialize → parse', () => {
  function roundTrip(md: string): string {
    _resetIdCounter();
    return serialize(parse(md).file);
  }

  // parse() always injects a leading "# Inbox" project when the source has
  // none (unchanged from v1) — every case below lacks one, so the expected
  // output is the source with "# Inbox\n" prepended.

  test('checklist project round-trip', () => {
    const md = `# My List\n\n- [ ] Task one\n- [x] Task two\n`;
    expect(roundTrip(md)).toBe(`# Inbox\n${md}`);
  });

  test('kanban project round-trip', () => {
    const md = `# Board\n\n## Todo\n\n- [ ] Task A\n\n## Done\n\n- [x] Task B\n`;
    expect(roundTrip(md)).toBe(`# Inbox\n${md}`);
  });

  test('all token types round-trip byte-for-byte', () => {
    const md = `# P\n\n- [ ] Task !2025-12-01 >2025-11-01 @home $5 %3 ~2hrs &(2025-11-01) #urgent #pri/high ^my-id\n`;
    expect(roundTrip(md)).toBe(`# Inbox\n${md}`);
  });

  test('subtasks round-trip', () => {
    const md = `# P\n\n- [ ] Parent\n  - [ ] Child\n`;
    expect(roundTrip(md)).toBe(`# Inbox\n${md}`);
  });

  test('project description round-trip', () => {
    const md = `# P\n\nProject description here.\n\n- [ ] Task\n`;
    expect(roundTrip(md)).toBe(`# Inbox\n${md}`);
  });

  test('frontmatter round-trips verbatim when unchanged', () => {
    const md = `---\nowner: alice\n---\n\n# P\n\n- [ ] Task\n`;
    expect(roundTrip(md)).toBe(md.replace('# P', '# Inbox\n# P'));
  });
});

// ---- Canonical token order ----

describe('serialize - canonical token order', () => {
  test('tokens always emitted in canonical order: ! > @ $ % ~ & # ^', () => {
    // Input has tokens in non-canonical order
    const md = `# P\n\n- [ ] Task #urgent @home !2025-01-01\n`;
    const out = serialize(parse(md).file);
    const taskLine = out.split('\n').find(l => l.includes('Task'))!;
    const bangIdx = taskLine.indexOf('!');
    const atIdx = taskLine.indexOf('@');
    const hashIdx = taskLine.indexOf('#');
    expect(bangIdx).toBeLessThan(atIdx);
    expect(atIdx).toBeLessThan(hashIdx);
  });
});

describe('addMarkerToContent', () => {
  test('creates a block when there is none, leaving the body byte for byte', () => {
    expect(addMarkerToContent('# Title\n\n- [ ] a\n')).toBe('---\nmarkdone: 2\n---\n# Title\n\n- [ ] a\n');
  });

  test('prepends to an existing block', () => {
    expect(addMarkerToContent('---\nlayout: kanban\n---\n## Next\n')).toBe('---\nmarkdone: 2\nlayout: kanban\n---\n## Next\n');
  });

  test('handles an empty frontmatter block', () => {
    expect(addMarkerToContent('---\n---\nbody\n')).toBe('---\nmarkdone: 2\n---\nbody\n');
  });

  test('uses the file’s own line ending when it has no frontmatter', () => {
    expect(addMarkerToContent('# T\r\n- [ ] a\r\n')).toBe('---\r\nmarkdone: 2\r\n---\r\n# T\r\n- [ ] a\r\n');
  });

  test('refuses to add a second block to a CRLF file that already opens with a fence', () => {
    const crlf = '---\r\nlayout: kanban\r\n---\r\n## Next\r\n';
    expect(addMarkerToContent(crlf)).toBe(crlf);
  });

  test('refuses malformed frontmatter rather than rewriting broken YAML', () => {
    const broken = '---\nlayout: [unclosed\n---\n## Next\n';
    expect(addMarkerToContent(broken)).toBe(broken);
  });
});
