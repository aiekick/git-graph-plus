import type { Commit, FileStat, GraphDotData, GraphPathData } from './types';
import { DEFAULT_GRAPH_COLORS, resolveGraphColor } from './utils/graph-color';

/** Cell drawn where the commit sits on a lane. */
export const COMMIT_MARK = '●';
/** Cell drawn where a lane passes through a row without a commit. */
export const PASS_MARK = '│';

export interface ExportTable {
  headers: string[];
  rows: string[][];
  /** Graph color of each lane column (the first `laneColors.length` columns). */
  laneColors: string[];
  /** Per row: true for a file line of the detailed export (false for a commit). */
  fileRows: boolean[];
  /** Columns holding numbers (line counts), empty for the simple export. */
  numberColumns: number[];
}

export interface ExportLabels {
  /** Fallback lane header, `{n}` is the 1-based lane number. */
  lane: string;
  tag: string;
  description: string;
  author: string;
  sha: string;
  date: string;
  /** Detailed export only. */
  file?: string;
  additions?: string;
  deletions?: string;
}

export interface ExportOptions {
  palette?: string[];
  /** Detailed export: hash → files; adds File / Additions / Deletions columns
   *  and one line per file under its commit. */
  fileStats?: Record<string, FileStat[]>;
}

/** Row `i` of the graph is centred at y = i + 0.5 (see buildFullGraph). */
const rowCenter = (i: number) => i + 0.5;
const EPS = 1e-6;

/** First/last y covered by each rail path. */
function railSpans(paths: GraphPathData[]): Array<{ min: number; max: number }> {
  return paths.map(p => {
    let min = Infinity;
    let max = -Infinity;
    for (const pt of p.points) {
      if (pt.y < min) min = pt.y;
      if (pt.y > max) max = pt.y;
    }
    return { min, max };
  });
}

/**
 * Header for a rail: the branch on the topmost commit of that rail that carries
 * one (checked-out branch first, then local, then remote), or `null`.
 */
function railNames(commits: Commit[], dots: GraphDotData[]): Map<number, string> {
  const names = new Map<number, string>();
  for (let i = 0; i < commits.length; i++) {
    const rail = dots[i]?.rail;
    if (rail === undefined || names.has(rail)) continue;
    const refs = commits[i].refs;
    const head = refs.find(r => r.type === 'head' && r.name !== 'HEAD');
    const local = refs.find(r => r.type === 'branch');
    const remote = refs.find(r => r.type === 'remote-branch' && r.name !== 'HEAD');
    const name = head?.name ?? local?.name ?? (remote ? `${remote.remote}/${remote.name}` : undefined);
    if (name) names.set(rail, name);
  }
  return names;
}

/** `2026-11-08T12:34:56+01:00` → `2026-11-08 12:34` (author's own time zone). */
function formatDate(iso: string): string {
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return m ? `${m[1]} ${m[2]}` : iso;
}

/**
 * Builds the table for the selected graph rows: one column per lane (rail)
 * touching the selection, then tags, description, author, SHA and date.
 * Rows keep the graph order (newest first); the uncommitted-changes row is
 * skipped. `commits`, `dots` are index-aligned with the graph rows.
 *
 * With `fileStats`, File / Additions / Deletions columns are added: the commit
 * line holds the totals and each changed file gets its own line below it, with
 * the lanes continuing downwards drawn as `│`.
 */
export function buildSelectionTable(
  commits: Commit[],
  paths: GraphPathData[],
  dots: GraphDotData[],
  selected: Iterable<string>,
  labels: ExportLabels,
  options: ExportOptions = {},
): ExportTable {
  const palette = options.palette ?? DEFAULT_GRAPH_COLORS;
  const stats = options.fileStats;
  const sel = new Set(selected);
  const rowIdx: number[] = [];
  for (let i = 0; i < commits.length; i++) {
    if (commits[i].hash !== 'UNCOMMITTED' && sel.has(commits[i].hash)) rowIdx.push(i);
  }

  const spans = railSpans(paths);
  // Rail r passes row i when its path covers the row centre. The start point is
  // excluded: a rail born at a row either has its commit there (marked below)
  // or forks out of a merge commit sitting on another lane.
  const passes = (r: number, i: number) => {
    const y = rowCenter(i);
    return spans[r].min < y - EPS && y <= spans[r].max + EPS;
  };
  // Rail r carries on below row i (towards the commit's parents).
  const continues = (r: number, i: number) => {
    const y = rowCenter(i);
    return spans[r].min <= y + EPS && spans[r].max > y + EPS;
  };

  // Only lanes carrying at least one selected commit get a column; a lane that
  // merely passes through the selection would be a column of │ with no commit.
  const used = new Set<number>();
  for (const i of rowIdx) {
    const own = dots[i]?.rail;
    if (own !== undefined) used.add(own);
  }
  // Rails are emitted in lane order and never cross, so the path index is the
  // left-to-right order of the lanes.
  const rails = [...used].sort((a, b) => a - b);

  const names = railNames(commits, dots);
  const headers = [
    ...rails.map((r, k) => names.get(r) ?? labels.lane.replace('{n}', String(k + 1))),
    labels.tag, labels.description, labels.author, labels.sha, labels.date,
    ...(stats ? [labels.file ?? 'File', labels.additions ?? 'Additions', labels.deletions ?? 'Deletions'] : []),
  ];
  const fixed = rails.length + 5; // lanes + tag/description/author/sha/date
  const count = (n: number | null) => (n === null ? '-' : String(n));

  const rows: string[][] = [];
  const fileRows: boolean[] = [];
  for (const i of rowIdx) {
    const c = commits[i];
    const own = dots[i]?.rail;
    // A lone parentless commit (no rail at all) gets no lane mark.
    const lanes = rails.map(r => (r === own ? COMMIT_MARK : passes(r, i) ? PASS_MARK : ''));
    const tags = c.refs.filter(r => r.type === 'tag').map(r => r.name).join(', ');
    const row = [...lanes, tags, c.subject, c.author.name, c.abbreviatedHash, formatDate(c.author.date)];
    if (!stats) {
      rows.push(row);
      fileRows.push(false);
      continue;
    }
    const files = stats[c.hash] ?? [];
    const sum = (k: 'additions' | 'deletions') => files.reduce((n, f) => n + (f[k] ?? 0), 0);
    rows.push([...row, '', String(sum('additions')), String(sum('deletions'))]);
    fileRows.push(false);
    const below = rails.map(r => (continues(r, i) ? PASS_MARK : ''));
    for (const f of files) {
      rows.push([...below, '', '', '', '', '', f.path, count(f.additions), count(f.deletions)]);
      fileRows.push(true);
    }
  }

  const laneColors = rails.map(r => resolveGraphColor(palette, paths[r].color, paths[r].colorOverride));
  const numberColumns = stats ? [fixed + 1, fixed + 2] : [];
  return { headers, rows, laneColors, fileRows, numberColumns };
}

/** Quotes a field when it contains the delimiter, a quote or a line break. */
function csvField(v: string, delimiter: string): string {
  return v.includes(delimiter) || /["\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(t: ExportTable, delimiter = ';'): string {
  return [t.headers, ...t.rows].map(r => r.map(v => csvField(v, delimiter)).join(delimiter)).join('\n') + '\n';
}

function mdCell(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function toMarkdown(t: ExportTable): string {
  const line = (r: string[]) => `| ${r.map(mdCell).join(' | ')} |`;
  return [line(t.headers), `|${t.headers.map(() => ' --- ').join('|')}|`, ...t.rows.map(line)].join('\n') + '\n';
}
