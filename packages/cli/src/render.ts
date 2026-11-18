// Human-readable rendering for query results. --json output always just
// JSON.stringifies the raw op result, which is what a script should read —
// these renderers are for a person at a terminal.

interface TaskLocationLike {
  workspaceId: string;
  projectIndex: number;
  columnIndex?: number;
  taskIndex: number;
}

interface TaskLike {
  text: string;
  blockId?: string;
  dueDate?: string;
  checkbox: { state: string };
}

interface TaskWithLocationLike {
  task: TaskLike;
  location: TaskLocationLike;
  score?: TaskScoreLike; // present for `list --score`
}

function locationLabel(loc: TaskLocationLike): string {
  const parts = [`ws=${loc.workspaceId}`, `project=${loc.projectIndex}`];
  if (loc.columnIndex !== undefined) parts.push(`col=${loc.columnIndex}`);
  parts.push(`idx=${loc.taskIndex}`);
  return parts.join(' ');
}

function checkboxMark(state: string): string {
  return state === 'done' ? 'x' : state === 'cancelled' ? '-' : ' ';
}

export function renderTaskLine(item: TaskWithLocationLike): string {
  const t = item.task;
  const due = t.dueDate ? ` !${t.dueDate}` : '';
  const id = t.blockId ? ` ^${t.blockId}` : '';
  const signals = item.score ? `  {imp=${formatSignal(item.score.importance)} urg=${formatSignal(item.score.urgency)} risk=${formatSignal(item.score.risk)}}` : '';
  return `[${checkboxMark(t.checkbox.state)}] ${t.text}${due}${id}  (${locationLabel(item.location)})${signals}`;
}

export function renderTaskList(items: TaskWithLocationLike[]): string {
  if (items.length === 0) return 'No tasks.';
  return items.map(renderTaskLine).join('\n');
}

export function renderNextActions(map: Record<string, TaskWithLocationLike>): string {
  const keys = Object.keys(map).sort();
  if (keys.length === 0) return 'No next actions.';
  return keys
    .map(key => `${key === '__inbox__' ? '(no context)' : `@${key}`}: ${renderTaskLine(map[key])}`)
    .join('\n');
}

interface EstimationBucketLike {
  count: number;
  meanRatio: number;
  minRatio: number;
  maxRatio: number;
}

interface EstimationAccuracyStatsLike extends EstimationBucketLike {
  byOwner: Record<string, EstimationBucketLike>;
  byComplexity: Record<string, EstimationBucketLike>;
}

function renderBucket(label: string, bucket: EstimationBucketLike): string {
  return `${label}: n=${bucket.count} mean=${bucket.meanRatio.toFixed(2)} min=${bucket.minRatio.toFixed(2)} max=${bucket.maxRatio.toFixed(2)}`;
}

export function renderAccuracy(stats: EstimationAccuracyStatsLike): string {
  if (stats.count === 0) return 'No completed tasks with both an estimate and an actual.';
  const lines = [renderBucket('overall', stats)];
  for (const [owner, bucket] of Object.entries(stats.byOwner).sort()) lines.push(renderBucket(`owner=${owner}`, bucket));
  for (const [complexity, bucket] of Object.entries(stats.byComplexity).sort()) {
    lines.push(renderBucket(`complexity=${complexity}`, bucket));
  }
  return lines.join('\n');
}

interface TaskScoreLike {
  importance?: number;
  urgency?: number;
  risk?: number;
  fit: { contexts: string[]; energy?: string; owner?: string };
}

function formatSignal(n: number | undefined): string {
  return n === undefined ? '(none)' : n.toFixed(2);
}

export function renderScore(s: TaskScoreLike): string {
  return [
    `importance: ${formatSignal(s.importance)}`,
    `urgency:    ${formatSignal(s.urgency)}`,
    `risk:       ${formatSignal(s.risk)}`,
    `fit:        contexts=${s.fit.contexts.join(',') || '(none)'} energy=${s.fit.energy ?? '(none)'} owner=${s.fit.owner ?? '(none)'}`,
  ].join('\n');
}
