// A small LCS-based line diff for previewing a mutation before it writes.
// Task files are small (hundreds of lines at most), so the O(n*m) table is
// not a concern; there is no diff library in the repo (or dependency) to
// reach for instead.
interface DiffLine {
  kind: 'same' | 'add' | 'remove';
  text: string;
}

function diffLines(before: string[], after: string[]): DiffLine[] {
  const n = before.length;
  const m = after.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = before[i] === after[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      result.push({ kind: 'same', text: before[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      result.push({ kind: 'remove', text: before[i] });
      i++;
    } else {
      result.push({ kind: 'add', text: after[j] });
      j++;
    }
  }
  while (i < n) {
    result.push({ kind: 'remove', text: before[i] });
    i++;
  }
  while (j < m) {
    result.push({ kind: 'add', text: after[j] });
    j++;
  }
  return result;
}

export function formatDiff(path: string, before: string | null, after: string | null): string {
  if (before === null) {
    const lines = (after ?? '').split('\n');
    return [`--- /dev/null`, `+++ ${path}`, ...lines.map(l => `+${l}`)].join('\n');
  }
  if (after === null) {
    const lines = before.split('\n');
    return [`--- ${path}`, `+++ /dev/null`, ...lines.map(l => `-${l}`)].join('\n');
  }
  const diffed = diffLines(before.split('\n'), after.split('\n'));
  const body = diffed.map(d => (d.kind === 'same' ? ` ${d.text}` : d.kind === 'add' ? `+${d.text}` : `-${d.text}`));
  return [`--- ${path}`, `+++ ${path}`, ...body].join('\n');
}
