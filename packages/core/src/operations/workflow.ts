import type { Project } from '../model/types';
import { getColumns } from '../model/accessors';

// Resolution of a kanban project's `on-complete` key (spec: "Workflow:
// on-complete"). The project's frontmatter `recognized` view already folds in
// the workspace default from `_markdone.md`, so a project's own value wins
// and an absent key inherits.
export type CompletionColumn =
  | { kind: 'off' } // none, or a checklist project (or a board with no columns)
  | { kind: 'column'; index: number }
  | { kind: 'unknown'; name: string }; // names a column that isn't in `columns`

export function resolveCompletionColumn(project: Project): CompletionColumn {
  if (project.layout !== 'kanban') return { kind: 'off' };
  const columns = getColumns(project);
  if (columns.length === 0) return { kind: 'off' };

  const raw = project.frontmatter.recognized['on-complete'];
  if (raw === undefined || raw === null) return { kind: 'column', index: columns.length - 1 };

  const name = String(raw).trim();
  if (name.toLowerCase() === 'none') return { kind: 'off' };
  const index = columns.findIndex(c => c.name.trim().toLowerCase() === name.toLowerCase());
  return index === -1 ? { kind: 'unknown', name } : { kind: 'column', index };
}

// The column index completion moves tasks into, or undefined when the rule
// is off (including an unresolvable name — it does not fall back to the last
// column; lint reports it).
export function completionColumnIndex(project: Project): number | undefined {
  const resolved = resolveCompletionColumn(project);
  return resolved.kind === 'column' ? resolved.index : undefined;
}
