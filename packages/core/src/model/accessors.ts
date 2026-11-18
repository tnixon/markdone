// Read/write helpers over the block-sequence model.
//
// Most consumers (existing operations, UI) want a flat `Task[]` the way v1
// gave them, not a `Block[]`. These accessors provide that view without
// requiring every caller to become block-aware, while the underlying
// storage stays a content-preserving block sequence.

import type {
  Block,
  ChecklistProject,
  KanbanProject,
  Project,
  Section,
  Task,
  TopLevelSection,
  Workspace,
} from './types';

function flattenTasks(blocks: Block[]): Task[] {
  const tasks: Task[] = [];
  for (const block of blocks) {
    if (block.type === 'task') tasks.push(block.task);
  }
  return tasks;
}

export function getTasks(project: ChecklistProject): Task[] {
  return flattenTasks(project.blocks);
}

export function getColumnTasks(section: Section): Task[] {
  return flattenTasks(section.blocks);
}

function isColumn(s: TopLevelSection): s is Extract<TopLevelSection, { kind: 'column' }> {
  return s.kind === 'column';
}

function isAuxiliary(s: TopLevelSection): s is Extract<TopLevelSection, { kind: 'auxiliary' }> {
  return s.kind === 'auxiliary';
}

// The board, in display order. When `columnOrder` is declared (spec D3) it
// is authoritative — a name with no matching section in the document
// becomes an empty column. Otherwise (spec D4), every column-kind section
// appears in document order.
export function getColumns(project: KanbanProject): Section[] {
  if (project.columnOrder) {
    return project.columnOrder.map(name => {
      const found = project.sections.filter(isColumn).find(s => s.name === name);
      return found ? { name: found.name, blocks: found.blocks } : { name, blocks: [] };
    });
  }
  return project.sections.filter(isColumn).map(s => ({ name: s.name, blocks: s.blocks }));
}

// Task-bearing H2s not named in `columns:`, rendered as checklists below
// the board, in document order. Only meaningful when `columnOrder` is
// declared — without one there is no "not in columns:" to speak of.
export function getAuxiliarySections(project: KanbanProject): Section[] {
  return project.sections.filter(isAuxiliary).map(s => ({ name: s.name, blocks: s.blocks }));
}

// Replaces the leading opaque content (before the first task) with a
// single new description block, leaving everything from the first task
// onward untouched. Pass `undefined` to remove the description entirely.
export function setDescription(project: Project, description: string | undefined): Project {
  const target = project.layout === 'checklist' ? project.blocks : project.preamble;
  const firstTaskIndex = target.findIndex(b => b.type === 'task');
  const rest = firstTaskIndex === -1 ? [] : target.slice(firstTaskIndex);
  const leading: Block[] = description ? [{ type: 'opaque', raw: description }] : [];
  const newBlocks = [...leading, ...rest];
  if (project.layout === 'checklist') return { ...project, blocks: newBlocks };
  return { ...project, preamble: newBlocks };
}

export function getDescription(project: Project): string | undefined {
  const blocks = project.layout === 'checklist' ? project.blocks : project.preamble;
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.type === 'task') break;
    if (block.raw.trim() !== '') lines.push(block.raw);
  }
  const text = lines.join('\n').trim();
  return text || undefined;
}

// Rebuilds a block list from a new task array, reattaching each surviving
// task's immediately-preceding opaque content. Two passes:
//
// 1. Anchors — a new task is matched to an original by reference identity
//    (an unchanged object, as `reorderTask` produces) or by `blockId` (an
//    in-place replacement that carries its id forward, as `updateTask`/
//    `completeTask`/etc. produce). Each original is used at most once.
// 2. Positional fill — every operation in the registry changes exactly one
//    task per call (replace-in-place, insert, delete, or move-with-a-new-
//    object), so after anchoring, at most one new task is left unmatched
//    and at most one original is left unconsumed, and by elimination they
//    are each other. More generally: walk the new tasks in order, and for
//    each one anchoring didn't claim, pair it with the next not-yet-consumed
//    original in *original* document order. This is what lets a task with
//    no `^id` keep its preceding prose in place across a mutation — the
//    id/identity anchor was never the only signal available, just the one
//    this function used to stop at.
//
// An original left unconsumed after both passes (a deleted task) has its
// preceding opaque content appended, in original relative order, just
// before the trailing content — content is never dropped, but its exact
// neighbor can drift under a mutation that deletes its anchor task.
function rebuildBlocks(blocks: Block[], newTasks: Task[]): Block[] {
  const originalTasks: Task[] = [];
  const precedingOpaque: Block[][] = [];
  let pending: Block[] = [];
  for (const block of blocks) {
    if (block.type === 'opaque') {
      pending.push(block);
    } else {
      originalTasks.push(block.task);
      precedingOpaque.push(pending);
      pending = [];
    }
  }
  const trailing = pending;

  const origIndexByRef = new Map<Task, number>();
  const origIndexByBlockId = new Map<string, number>();
  originalTasks.forEach((task, i) => {
    origIndexByRef.set(task, i);
    if (task.blockId !== undefined) origIndexByBlockId.set(task.blockId, i);
  });

  const matchedOrigIndex: (number | undefined)[] = new Array(newTasks.length).fill(undefined);
  const origConsumed = new Array<boolean>(originalTasks.length).fill(false);

  // Pass 1: anchors.
  newTasks.forEach((task, newIndex) => {
    let origIndex = origIndexByRef.get(task);
    if (origIndex === undefined && task.blockId !== undefined) {
      origIndex = origIndexByBlockId.get(task.blockId);
    }
    if (origIndex !== undefined && !origConsumed[origIndex]) {
      matchedOrigIndex[newIndex] = origIndex;
      origConsumed[origIndex] = true;
    }
  });

  // Pass 2: positional fill, in document order on both sides.
  let fillCursor = 0;
  for (let newIndex = 0; newIndex < newTasks.length; newIndex++) {
    if (matchedOrigIndex[newIndex] !== undefined) continue;
    while (fillCursor < originalTasks.length && origConsumed[fillCursor]) fillCursor++;
    if (fillCursor < originalTasks.length) {
      matchedOrigIndex[newIndex] = fillCursor;
      origConsumed[fillCursor] = true;
      fillCursor++;
    }
  }

  const result: Block[] = [];
  for (let newIndex = 0; newIndex < newTasks.length; newIndex++) {
    const origIndex = matchedOrigIndex[newIndex];
    if (origIndex !== undefined) result.push(...precedingOpaque[origIndex]);
    result.push({ type: 'task', task: newTasks[newIndex] });
  }
  for (let i = 0; i < originalTasks.length; i++) {
    if (!origConsumed[i] && precedingOpaque[i].length > 0) {
      result.push(...precedingOpaque[i]);
    }
  }
  result.push(...trailing);
  return result;
}

export function setTasks(project: ChecklistProject, newTasks: Task[]): ChecklistProject {
  return { ...project, blocks: rebuildBlocks(project.blocks, newTasks) };
}

export function setColumnTasks(section: Section, newTasks: Task[]): Section {
  return { ...section, blocks: rebuildBlocks(section.blocks, newTasks) };
}

// --- Column-structure mutation (add/rename/delete/reorder a column) ---
//
// When `columnOrder` is declared, document order (`sections`) and display
// order (`columnOrder`) are tracked separately and kept in sync. Without a
// declared order (v1-compatible inferred kanban), document order IS display
// order, so these operate on `sections` directly.

export function insertColumn(project: KanbanProject, name: string, atIndex?: number): KanbanProject {
  const sections = [...project.sections];
  const newSection: TopLevelSection = { kind: 'column', name, blocks: [] };
  if (project.columnOrder) {
    sections.push(newSection);
    const columnOrder = [...project.columnOrder];
    columnOrder.splice(atIndex ?? columnOrder.length, 0, name);
    return { ...project, sections, columnOrder };
  }
  const columnIndices = sections.reduce<number[]>((acc, s, i) => (isColumn(s) ? [...acc, i] : acc), []);
  const insertAt = atIndex !== undefined && atIndex < columnIndices.length ? columnIndices[atIndex] : sections.length;
  sections.splice(insertAt, 0, newSection);
  return { ...project, sections };
}

export function renameColumnAt(project: KanbanProject, index: number, newName: string): KanbanProject {
  const columns = getColumns(project);
  const oldName = columns[index]?.name;
  if (oldName === undefined) return project;
  const sections = project.sections.map(s => (isColumn(s) && s.name === oldName ? { ...s, name: newName } : s));
  const columnOrder = project.columnOrder?.map(n => (n === oldName ? newName : n));
  return { ...project, sections, columnOrder };
}

export function removeColumnAt(project: KanbanProject, index: number): KanbanProject {
  const columns = getColumns(project);
  const name = columns[index]?.name;
  if (name === undefined) return project;
  const sections = project.sections.filter(s => !(isColumn(s) && s.name === name));
  const columnOrder = project.columnOrder?.filter(n => n !== name);
  return { ...project, sections, columnOrder };
}

export function reorderColumnAt(project: KanbanProject, index: number, newIndex: number): KanbanProject {
  const columns = getColumns(project);
  const name = columns[index]?.name;
  if (name === undefined) return project;
  if (project.columnOrder) {
    const columnOrder = project.columnOrder.filter(n => n !== name);
    columnOrder.splice(newIndex, 0, name);
    return { ...project, columnOrder };
  }
  const columnEntries = project.sections.filter(isColumn);
  const rest = project.sections.filter(s => !isColumn(s));
  const moving = columnEntries.find(s => s.name === name);
  if (!moving) return project;
  const reordered = columnEntries.filter(s => s.name !== name);
  reordered.splice(newIndex, 0, moving);
  // Column-kind sections are re-emitted in their new relative order,
  // followed by non-column sections in their original relative order.
  // Interleaving between column and non-column sections in the source
  // document is not preserved across a reorder — a reasonable trade-off
  // since inferred-mode kanban has no other way to express column order.
  return { ...project, sections: [...reordered, ...rest] };
}

// --- Reserved nested-tag readers (spec: "Tags" — owner/waiting/energy/
// after/every) ---
//
// These are deliberately *readers*, not fields on `Task`: the spec models
// owner/waiting/energy/after/every as tag values, not separate persisted
// properties, so a task keeps exactly one representation on disk and there's
// nothing to fall out of sync. Each getter here is the typed view over that
// same `tags` array.

function findNestedTag(task: Task, key: string): string | undefined {
  const tag = task.tags.find(t => t.type === 'nested' && t.key === key);
  return tag?.type === 'nested' ? tag.value : undefined;
}

// The effective owner resolves: an explicit `#owner/` tag on the task, else
// the project's frontmatter `owner`, else the workspace-level default (the
// workspace frontmatter in file mode; already folded into the project's own
// frontmatter for directory mode, since `_markdone.md` defaults are merged
// in at parse time — see parser/parse.ts's `applyDefaults`).
export function getEffectiveOwner(task: Task, project: Project, workspace: Workspace): string | undefined {
  const own = findNestedTag(task, 'owner');
  if (own !== undefined) return own;
  const projectOwner = project.frontmatter.recognized.owner;
  if (typeof projectOwner === 'string') return projectOwner;
  const workspaceOwner = workspace.todoFile.frontmatter.recognized.owner;
  return typeof workspaceOwner === 'string' ? workspaceOwner : undefined;
}

// Any `#waiting/` tag puts the task in waiting-for state, regardless of its value.
export function isWaiting(task: Task): boolean {
  return task.tags.some(t => t.type === 'nested' && t.key === 'waiting');
}

const ENERGY_LEVELS = ['low', 'med', 'high'] as const;
export type EnergyLevel = (typeof ENERGY_LEVELS)[number];

export function getEnergy(task: Task): EnergyLevel | undefined {
  const value = findNestedTag(task, 'energy');
  return (ENERGY_LEVELS as readonly string[]).includes(value ?? '') ? (value as EnergyLevel) : undefined;
}

// The block id of the task this one depends on (`#after/<id>`), unresolved —
// resolving it to a location is `resolveTaskRef`'s job (operations/utils.ts).
export function getDependency(task: Task): string | undefined {
  return findNestedTag(task, 'after');
}

// The raw `#every/<rule>` value. This spec defines only the syntax;
// generating the next occurrence from the rule is consumer behavior.
export function getRecurrence(task: Task): string | undefined {
  return findNestedTag(task, 'every');
}
