/**
 * Repository statistics computed from one
 * `git log --no-merges --numstat --format=%x01%H%x00%ae%x00%an%x00%aI` run:
 * contributors (grouped by e-mail), activity over time, file / folder
 * hotspots and the weekday × hour heatmap. Pure, so it is unit-testable and
 * runs once per filter in the extension host (the webview gets the result).
 */

export interface StatsAuthor {
  /** Lower-cased e-mail: the grouping key. */
  key: string;
  /** Most used name for this e-mail. */
  name: string;
  /** Every name seen for this e-mail (most used first). */
  names: string[];
  commits: number;
  additions: number;
  deletions: number;
  /** Distinct files touched. */
  files: number;
  /** YYYY-MM-DD of the first / last commit (author's own time zone). */
  firstDate: string;
  lastDate: string;
}

export interface StatsPathEntry {
  path: string;
  commits: number;
  additions: number;
  deletions: number;
  /** Distinct authors who changed it. */
  authors: number;
}

export interface StatsReport {
  totals: { commits: number; authors: number; additions: number; deletions: number; files: number; firstDate: string | null; lastDate: string | null };
  authors: StatsAuthor[];
  /** Commits per bucket; `starts` are the YYYY-MM-DD first days of each bucket. */
  timeline: { unit: 'day' | 'week' | 'month'; starts: string[]; total: number[]; byAuthor: Record<string, number[]> };
  /** Most changed files and folders (by commits), longest lists first capped. */
  files: StatsPathEntry[];
  folders: StatsPathEntry[];
  /** Most changed files of each author. */
  authorTopFiles: Record<string, Array<{ path: string; commits: number }>>;
  /** Commits per [weekday 0=Sun][hour], author's own time zone. */
  weekdayHour: number[][];
}

const RECORD = '\x01';
const MAX_PATHS = 300;
const MAX_AUTHOR_FILES = 10;

/** `dir/{old => new}/f` / `old => new` (numstat renames) → the new path. */
export function renamedPath(p: string): string {
  if (p.includes('{') && p.includes(' => ')) {
    return p.replace(/\{([^{}]*) => ([^{}]*)\}/g, '$2').replace(/\/\/+/g, '/').replace(/^\//, '');
  }
  const i = p.indexOf(' => ');
  return i >= 0 ? p.slice(i + 4) : p;
}

const dayNumber = (ymd: string) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10)) / 86400000;
const ymdOf = (day: number) => new Date(day * 86400000).toISOString().slice(0, 10);

/** First day of the bucket holding `ymd`. Weeks start on Monday. */
function bucketStart(ymd: string, unit: 'day' | 'week' | 'month'): string {
  if (unit === 'month') return ymd.slice(0, 7) + '-01';
  if (unit === 'day') return ymd;
  const d = dayNumber(ymd);
  const weekday = (new Date(d * 86400000).getUTCDay() + 6) % 7; // Monday = 0
  return ymdOf(d - weekday);
}

function nextBucket(ymd: string, unit: 'day' | 'week' | 'month'): string {
  if (unit === 'month') {
    let y = +ymd.slice(0, 4);
    let m = +ymd.slice(5, 7) + 1;
    if (m > 12) { m = 1; y++; }
    return `${y}-${String(m).padStart(2, '0')}-01`;
  }
  return ymdOf(dayNumber(ymd) + (unit === 'day' ? 1 : 7));
}

/** Day buckets up to 2 months, weeks up to 2 years, months beyond. */
export function pickTimelineUnit(firstDate: string, lastDate: string): 'day' | 'week' | 'month' {
  const span = dayNumber(lastDate) - dayNumber(firstDate);
  return span <= 62 ? 'day' : span <= 730 ? 'week' : 'month';
}

interface PathAcc { commits: number; additions: number; deletions: number; authors: Set<string> }

export function buildStatsReport(raw: string): StatsReport {
  const authors = new Map<string, {
    names: Map<string, number>; commits: number; additions: number; deletions: number;
    files: Map<string, number>; first: string; last: string; dates: string[];
  }>();
  const files = new Map<string, PathAcc>();
  const folders = new Map<string, PathAcc>();
  const weekdayHour = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
  let commits = 0, additions = 0, deletions = 0;
  let first: string | null = null, last: string | null = null;

  const touch = (map: Map<string, PathAcc>, path: string, author: string, add: number, del: number) => {
    let acc = map.get(path);
    if (!acc) { acc = { commits: 0, additions: 0, deletions: 0, authors: new Set() }; map.set(path, acc); }
    acc.commits++;
    acc.additions += add;
    acc.deletions += del;
    acc.authors.add(author);
  };

  for (const chunk of raw.split(RECORD)) {
    const nl = chunk.indexOf('\n');
    const header = nl >= 0 ? chunk.slice(0, nl) : chunk;
    const [hash, email, name, date] = header.split('\x00');
    if (!hash || !date) continue;
    const ymd = date.slice(0, 10);
    const key = (email || name || '?').trim().toLowerCase();
    commits++;
    if (!first || ymd < first) first = ymd;
    if (!last || ymd > last) last = ymd;

    let a = authors.get(key);
    if (!a) {
      a = { names: new Map(), commits: 0, additions: 0, deletions: 0, files: new Map(), first: ymd, last: ymd, dates: [] };
      authors.set(key, a);
    }
    a.names.set(name, (a.names.get(name) ?? 0) + 1);
    a.commits++;
    if (ymd < a.first) a.first = ymd;
    if (ymd > a.last) a.last = ymd;
    a.dates.push(ymd);

    const hm = /T(\d{2})/.exec(date);
    if (hm) weekdayHour[new Date(dayNumber(ymd) * 86400000).getUTCDay()][+hm[1]]++;

    // Folders are counted once per commit even if several of their files changed.
    const commitFolders = new Map<string, { add: number; del: number }>();
    for (const line of (nl >= 0 ? chunk.slice(nl + 1) : '').split('\n')) {
      const m = /^(-|\d+)\t(-|\d+)\t(.+)$/.exec(line);
      if (!m) continue;
      const add = m[1] === '-' ? 0 : +m[1];
      const del = m[2] === '-' ? 0 : +m[2];
      const path = renamedPath(m[3]);
      additions += add; deletions += del;
      a.additions += add; a.deletions += del;
      a.files.set(path, (a.files.get(path) ?? 0) + 1);
      touch(files, path, key, add, del);
      const parts = path.split('/');
      for (let i = 1; i < parts.length; i++) {
        const dir = parts.slice(0, i).join('/');
        const f = commitFolders.get(dir) ?? { add: 0, del: 0 };
        f.add += add; f.del += del;
        commitFolders.set(dir, f);
      }
    }
    for (const [dir, f] of commitFolders) touch(folders, dir, key, f.add, f.del);
  }

  const toEntries = (map: Map<string, PathAcc>): StatsPathEntry[] =>
    [...map.entries()]
      .map(([path, acc]) => ({ path, commits: acc.commits, additions: acc.additions, deletions: acc.deletions, authors: acc.authors.size }))
      .sort((x, y) => y.commits - x.commits || (y.additions + y.deletions) - (x.additions + x.deletions) || x.path.localeCompare(y.path))
      .slice(0, MAX_PATHS);

  const authorList: StatsAuthor[] = [...authors.entries()].map(([key, a]) => {
    const names = [...a.names.entries()].sort((x, y) => y[1] - x[1]).map(([n]) => n);
    return {
      key, name: names[0] || key, names, commits: a.commits, additions: a.additions, deletions: a.deletions,
      files: a.files.size, firstDate: a.first, lastDate: a.last,
    };
  }).sort((x, y) => y.commits - x.commits || x.name.localeCompare(y.name));

  // Timeline: contiguous buckets from the first to the last commit.
  const unit = first && last ? pickTimelineUnit(first, last) : 'month';
  const starts: string[] = [];
  if (first && last) {
    const end = bucketStart(last, unit);
    for (let b = bucketStart(first, unit); b <= end; b = nextBucket(b, unit)) starts.push(b);
  }
  const index = new Map(starts.map((s, i) => [s, i]));
  const total = new Array<number>(starts.length).fill(0);
  const byAuthor: Record<string, number[]> = {};
  const authorTopFiles: StatsReport['authorTopFiles'] = {};
  for (const [key, a] of authors) {
    const series = new Array<number>(starts.length).fill(0);
    for (const d of a.dates) {
      const i = index.get(bucketStart(d, unit));
      if (i !== undefined) { series[i]++; total[i]++; }
    }
    byAuthor[key] = series;
    authorTopFiles[key] = [...a.files.entries()]
      .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
      .slice(0, MAX_AUTHOR_FILES)
      .map(([path, n]) => ({ path, commits: n }));
  }

  return {
    totals: { commits, authors: authors.size, additions, deletions, files: files.size, firstDate: first, lastDate: last },
    authors: authorList,
    timeline: { unit, starts, total, byAuthor },
    files: toEntries(files),
    folders: toEntries(folders),
    authorTopFiles,
    weekdayHour,
  };
}
