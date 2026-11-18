// Tag: a plain #label, or a nested #key/value tag (Obsidian nested-tag style).
// `nested` replaces v1's `keyvalue` (`#key(value)`) — same shape, new wire syntax.
export type Tag =
  | { type: 'label'; name: string }
  | { type: 'nested'; key: string; value: string };

export type Effort = {
  amount: number;
  unit: 'min' | 'hrs' | 'days' | 'wks';
};

export type Actual = {
  completionDate: string;
  startDate?: string;
  duration?: Effort;
};

// Checkbox state. `other` covers any single character the spec doesn't
// assign meaning to (e.g. Obsidian Tasks' `[/]`, `[>]`) — `marker` carries
// the raw character so it round-trips even though Markdone doesn't interpret
// it. For `open`/`done`/`cancelled`, `marker` is redundant with `state` but
// still populated (` `, `x`, `-`) for uniform serialization.
export type CheckboxState = 'open' | 'done' | 'cancelled' | 'other';

export type Checkbox = {
  state: CheckboxState;
  marker: string;
};

export type Task = {
  // Ephemeral, in-memory identifier — always present, regenerated on every
  // parse (unchanged from v1). Used for UI keys and current-session
  // addressing. NOT persisted to Markdown.
  id: string;
  // Persistent, optional `^id` block identifier (spec: workspace-unique,
  // must be last on the line). Named `blockId` rather than reusing `id` to
  // avoid conflating the two very different lifetimes above.
  blockId?: string;
  text: string;
  checkbox: Checkbox;
  // Mirrors `checkbox.state === 'done'`. Kept as a real field (rather than
  // computed on read) so existing comparisons (`task.completed`) keep
  // working; every mutator that changes completion must set both together.
  completed: boolean;
  dueDate?: string;
  deferDate?: string;
  contexts: string[];
  value?: number;
  complexity?: number;
  effort?: Effort;
  actual?: Actual;
  tags: Tag[];
  subtasks: Task[];
};

// A unit of project content: a real task, or a verbatim run of source lines
// the parser doesn't interpret (prose, callouts, fenced code, headings that
// aren't recognized as structure, blank lines). Content preservation (spec
// hard requirement 2) depends on every project body being modeled as an
// ordered sequence of these — never a bare `Task[]` — so nothing the parser
// doesn't understand can be silently dropped on the next save.
export type Block =
  | { type: 'task'; task: Task }
  | { type: 'opaque'; raw: string };

// A named run of blocks under one H2 heading (a kanban column or auxiliary
// checklist section).
export type Section = {
  name: string;
  blocks: Block[];
};

// One H2-delimited region of a kanban project body, classified per spec:
// - column: a declared board column (or, with no `columns:` declared, any
//   H2 containing a task — see KanbanProject.columnOrder)
// - auxiliary: a task-bearing H2 not named in `columns:`, rendered as a
//   checklist below the board
// - opaque: an H2 section that is neither — preserved verbatim, not
//   surfaced as board or checklist content
export type TopLevelSection =
  | ({ kind: 'column' } & Section)
  | ({ kind: 'auxiliary' } & Section)
  | { kind: 'opaque'; raw: string };

// YAML frontmatter. `raw` is the exact source text between the `---`
// delimiters (no delimiters) and is what gets serialized verbatim when
// nothing recognized has changed — this, not a hand-rolled diff, is what
// keeps comments/quoting/order intact for an unmodified file. `recognized`
// and `unknown` are parsed views for typed access; mutating a recognized key
// goes through `updateFrontmatterKey` (parser/frontmatter.ts), which is the
// only place that actually rewrites `raw`.
export type Frontmatter = {
  raw: string;
  recognized: Record<string, unknown>;
  unknown: Record<string, unknown>;
  // Whether a frontmatter block existed in the source at all — distinguishes
  // "empty frontmatter" from "no frontmatter", which matters when writing.
  present: boolean;
};

export type ChecklistProject = {
  layout: 'checklist';
  name: string;
  // Directory mode only: workspace-relative path of the file this project was
  // loaded from, `.md` included. Ephemeral — set by the handle on load, never
  // serialized — so callers can address a project's file without
  // re-implementing discovery.
  sourcePath?: string;
  frontmatter: Frontmatter;
  // Every task anywhere in this project belongs to one flat list, in
  // document order, regardless of what headings it sits under (spec D2).
  blocks: Block[];
};

export type KanbanProject = {
  layout: 'kanban';
  name: string;
  sourcePath?: string;
  frontmatter: Frontmatter;
  // Opaque content before the first H2.
  preamble: Block[];
  // One entry per H2 in the document, in document order.
  sections: TopLevelSection[];
  // From frontmatter `columns:`, when declared — the authoritative board
  // order (spec D3). Undefined means "infer": every task-bearing H2 is a
  // column, in document order, with no auxiliary sections (spec D4).
  columnOrder?: string[];
};

export type Project = ChecklistProject | KanbanProject;

export type TodoFile = {
  // Workspace-level frontmatter (file mode only — see spec "Frontmatter").
  frontmatter: Frontmatter;
  // Opaque content between the frontmatter (or file start) and the first
  // `# Project` heading — typically just the blank line that separates
  // them, but preserved generally for content preservation.
  preamble: Block[];
  projects: Project[];
};

export type WorkspaceConfig = {
  id: string;
  name: string;
  filePath: string;
  color?: string;
};

export type Workspace = {
  config: WorkspaceConfig;
  todoFile: TodoFile;
};

export type AppState = {
  workspaces: Workspace[];
  // 'all' = unified view across all workspaces; otherwise a workspace id
  activeScope: string;
};
