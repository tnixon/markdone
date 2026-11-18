// Block-sequence body parsing, shared by checklist and kanban projects.
//
// The core content-preservation mechanism (spec hard requirement 2): every
// line of a project body is classified as either a task line or opaque
// content, and nothing is ever discarded — unrecognized lines become
// `{type: 'opaque', raw}` blocks that re-emit verbatim.

import type { Block, Task, TopLevelSection } from '../model/types';
import { parseCheckboxLine, tokenizeTaskLine, type CheckboxLine } from './tokenize';

let _nextId = 1;
function generateId(): string {
  return `task-${_nextId++}`;
}

// Exported for testing to reset id counter
export function _resetIdCounter(): void {
  _nextId = 1;
}

function isTaskLine(line: string): boolean {
  return /^- \[.\] /.test(line);
}

function buildTask(cbLine: CheckboxLine, warnings: string[]): Task {
  const t = tokenizeTaskLine(cbLine.rest);
  warnings.push(...t.warnings);
  const task: Task = {
    id: generateId(),
    text: t.text,
    checkbox: cbLine.checkbox,
    completed: cbLine.checkbox.state === 'done',
    contexts: t.contexts,
    tags: t.tags,
    subtasks: [],
  };
  if (t.blockId !== undefined) task.blockId = t.blockId;
  if (t.dueDate !== undefined) task.dueDate = t.dueDate;
  if (t.deferDate !== undefined) task.deferDate = t.deferDate;
  if (t.value !== undefined) task.value = t.value;
  if (t.complexity !== undefined) task.complexity = t.complexity;
  if (t.effort !== undefined) task.effort = t.effort;
  if (t.actual !== undefined) task.actual = t.actual;
  return task;
}

// Parses a flat run of lines (no H2 splitting) into an ordered block
// sequence. Used for checklist project bodies, kanban preamble/sections,
// and (via callers) anywhere else a "just tasks and prose" region occurs.
export function parseChecklistBody(lines: string[], warnings: string[]): Block[] {
  const blocks: Block[] = [];
  let opaqueRun: string[] = [];

  function flushOpaque(): void {
    if (opaqueRun.length > 0) {
      blocks.push({ type: 'opaque', raw: opaqueRun.join('\n') });
      opaqueRun = [];
    }
  }

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const cb = parseCheckboxLine(line);
    if (cb && cb.indent === '') {
      flushOpaque();
      const task = buildTask(cb, warnings);
      i++;
      while (i < lines.length) {
        const subCb = parseCheckboxLine(lines[i]);
        if (subCb && subCb.indent === '  ') {
          task.subtasks.push(buildTask(subCb, warnings));
          i++;
        } else {
          break;
        }
      }
      blocks.push({ type: 'task', task });
    } else {
      opaqueRun.push(line);
      i++;
    }
  }
  flushOpaque();
  return blocks;
}

export type ColumnInferenceMode = 'declared' | 'any-h2' | 'task-bearing-only';

// Splits a kanban project body into preamble + H2-delimited sections,
// classifying each H2 as a column, an auxiliary checklist section, or
// (task-bearing-only mode only) opaque prose — per spec "Project
// Structure". `mode` captures the three cases the spec distinguishes:
//   - 'declared'          — directory mode, `columns:` frontmatter present
//   - 'any-h2'             — file mode (v1-compatible: every H2 is a column)
//   - 'task-bearing-only' — directory mode kanban, no `columns:` declared
export function splitKanbanBody(
  lines: string[],
  mode: ColumnInferenceMode,
  declaredColumns: string[] | undefined,
  warnings: string[],
): { preamble: Block[]; sections: TopLevelSection[] } {
  const firstH2 = lines.findIndex(l => l.startsWith('## '));
  const preambleLines = firstH2 === -1 ? lines : lines.slice(0, firstH2);
  const preamble = parseChecklistBody(preambleLines, warnings);

  const sections: TopLevelSection[] = [];
  if (firstH2 === -1) return { preamble, sections };

  const rawSegments: { headingLine: string; name: string; lines: string[] }[] = [];
  let current: { headingLine: string; name: string; lines: string[] } | null = null;

  for (let i = firstH2; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('## ')) {
      if (current) rawSegments.push(current);
      current = { headingLine: line, name: line.slice(3).trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) rawSegments.push(current);

  for (const segment of rawSegments) {
    const hasTask = segment.lines.some(isTaskLine);
    let kind: 'column' | 'auxiliary' | 'opaque';
    if (mode === 'declared') {
      if (declaredColumns && declaredColumns.includes(segment.name)) {
        kind = 'column';
      } else {
        // Per spec: an H2 not named in `columns:` is only an auxiliary
        // checklist section if it actually has a task in it — otherwise
        // it's plain prose, same as 'task-bearing-only' mode's rule.
        kind = hasTask ? 'auxiliary' : 'opaque';
      }
    } else if (mode === 'any-h2') {
      kind = 'column';
    } else {
      kind = hasTask ? 'column' : 'opaque';
    }

    if (kind === 'opaque') {
      sections.push({ kind: 'opaque', raw: [segment.headingLine, ...segment.lines].join('\n') });
    } else {
      sections.push({ kind, name: segment.name, blocks: parseChecklistBody(segment.lines, warnings) });
    }
  }

  return { preamble, sections };
}
