import type { Actual, Block, Effort, Frontmatter, KanbanProject, Project, Tag, Task, TodoFile } from '../model/types';
import { serializeFrontmatter, updateFrontmatterKey } from './frontmatter';
import { escapeDescription } from './tokenize';

function serializeEffort(effort: Effort): string {
  return `${effort.amount}${effort.unit}`;
}

function serializeActual(actual: Actual): string {
  const inner = actual.startDate ? `${actual.startDate}, ${actual.completionDate}` : actual.completionDate;
  const duration = actual.duration ? `:${serializeEffort(actual.duration)}` : '';
  return `&(${inner})${duration}`;
}

function serializeTag(tag: Tag): string {
  return tag.type === 'label' ? `#${tag.name}` : `#${tag.key}/${tag.value}`;
}

// Canonical order: ! > @ $ % ~ & #, then ^id strictly last.
function serializeTaskTokens(task: Task): string {
  const tokens: string[] = [escapeDescription(task.text)];
  if (task.dueDate) tokens.push(`!${task.dueDate}`);
  if (task.deferDate) tokens.push(`>${task.deferDate}`);
  for (const ctx of task.contexts) tokens.push(`@${ctx}`);
  if (task.value !== undefined) tokens.push(`$${task.value}`);
  if (task.complexity !== undefined) tokens.push(`%${task.complexity}`);
  if (task.effort) tokens.push(`~${serializeEffort(task.effort)}`);
  if (task.actual) tokens.push(serializeActual(task.actual));
  for (const tag of task.tags) tokens.push(serializeTag(tag));
  if (task.blockId) tokens.push(`^${task.blockId}`);
  return tokens.join(' ');
}

function serializeTaskLines(task: Task, indent = ''): string[] {
  const line = `${indent}- [${task.checkbox.marker}] ${serializeTaskTokens(task)}`;
  const subtaskLines = task.subtasks.flatMap(st => serializeTaskLines(st, `${indent}  `));
  return [line, ...subtaskLines];
}

function blockLines(blocks: Block[]): string[] {
  const lines: string[] = [];
  for (const block of blocks) {
    if (block.type === 'opaque') {
      lines.push(...block.raw.split('\n'));
    } else {
      lines.push(...serializeTaskLines(block.task));
    }
  }
  return lines;
}

export function frontmatterLines(fm: Frontmatter): string[] {
  const text = serializeFrontmatter(fm);
  if (!text) return [];
  // serializeFrontmatter returns "---\n<raw>\n---\n" — split into lines,
  // dropping the single trailing empty entry from the final \n.
  const withTrailingNewline = text.split('\n');
  withTrailingNewline.pop();
  return withTrailingNewline;
}

// Reconciles a kanban project's `columnOrder` (which operations mutate
// directly) back into its frontmatter before serialization, so a column
// add/rename/delete/reorder is reflected in the written `columns:` key
// without every mutator having to call updateFrontmatterKey itself.
function syncColumnsFrontmatter(project: KanbanProject): Frontmatter {
  if (project.columnOrder === undefined) return project.frontmatter;
  const current = project.frontmatter.recognized.columns;
  const same =
    Array.isArray(current) &&
    current.length === project.columnOrder.length &&
    current.every((v, i) => v === project.columnOrder![i]);
  if (same) return project.frontmatter;
  return updateFrontmatterKey(project.frontmatter, 'columns', project.columnOrder);
}

function fileModeProjectLines(project: Project): string[] {
  const heading = `# ${project.name}`;
  if (project.layout === 'checklist') {
    return [heading, ...blockLines(project.blocks)];
  }
  const lines = [heading, ...blockLines(project.preamble)];
  for (const section of project.sections) {
    if (section.kind === 'opaque') {
      lines.push(...section.raw.split('\n'));
    } else {
      lines.push(`## ${section.name}`, ...blockLines(section.blocks));
    }
  }
  return lines;
}

export function serialize(file: TodoFile): string {
  const lines: string[] = [...frontmatterLines(file.frontmatter), ...blockLines(file.preamble)];
  for (const project of file.projects) {
    lines.push(...fileModeProjectLines(project));
  }
  return lines.join('\n');
}

// Directory mode: one project, serialized as the sole content of its file
// (no `# Project` heading — the note's `title` frontmatter or filename
// carries the name instead, per spec).
export function serializeProject(project: Project): string {
  if (project.layout === 'checklist') {
    const lines = [...frontmatterLines(project.frontmatter), ...blockLines(project.blocks)];
    return lines.join('\n');
  }
  const frontmatter = syncColumnsFrontmatter(project);
  const lines = [...frontmatterLines(frontmatter), ...blockLines(project.preamble)];
  for (const section of project.sections) {
    if (section.kind === 'opaque') {
      lines.push(...section.raw.split('\n'));
    } else {
      lines.push(`## ${section.name}`, ...blockLines(section.blocks));
    }
  }
  return lines.join('\n');
}

export { serializeTaskTokens };
