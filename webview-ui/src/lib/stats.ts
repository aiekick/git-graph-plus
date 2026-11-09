// Mirrors src/git/stats-report.ts (StatsReport) and src/git/types.ts (StatsFilter).

export interface StatsFilter {
  since?: string;
  until?: string;
  scope: string;
  path?: string;
}

export interface StatsAuthor {
  key: string;
  name: string;
  names: string[];
  commits: number;
  additions: number;
  deletions: number;
  files: number;
  firstDate: string;
  lastDate: string;
}

export interface StatsPathEntry {
  path: string;
  commits: number;
  additions: number;
  deletions: number;
  authors: number;
}

export interface StatsReport {
  totals: { commits: number; authors: number; additions: number; deletions: number; files: number; firstDate: string | null; lastDate: string | null };
  authors: StatsAuthor[];
  timeline: { unit: 'day' | 'week' | 'month'; starts: string[]; total: number[]; byAuthor: Record<string, number[]> };
  files: StatsPathEntry[];
  folders: StatsPathEntry[];
  authorTopFiles: Record<string, Array<{ path: string; commits: number }>>;
  weekdayHour: number[][];
}

export type StatsPeriod = '30d' | '90d' | '6m' | '1y' | 'all' | 'custom';

const PERIOD_DAYS: Record<Exclude<StatsPeriod, 'all' | 'custom'>, number> = { '30d': 30, '90d': 90, '6m': 182, '1y': 365 };

/** Local YYYY-MM-DD of a Date. */
export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The since/until bounds of a period, relative to `today`. */
export function periodBounds(period: StatsPeriod, today: Date, custom?: { from?: string; to?: string }): { since?: string; until?: string } {
  if (period === 'all') return {};
  if (period === 'custom') return { since: custom?.from || undefined, until: custom?.to || undefined };
  const d = new Date(today);
  d.setDate(d.getDate() - PERIOD_DAYS[period] + 1);
  return { since: ymd(d) };
}

export type AuthorSortKey = 'name' | 'commits' | 'additions' | 'deletions' | 'files' | 'firstDate' | 'lastDate';

/** Authors matching `query` (name, other names or e-mail), sorted. */
export function filterAndSortAuthors(authors: StatsAuthor[], query: string, key: AuthorSortKey, desc: boolean): StatsAuthor[] {
  const q = query.trim().toLowerCase();
  const list = q
    ? authors.filter(a => a.key.includes(q) || a.names.some(n => n.toLowerCase().includes(q)))
    : [...authors];
  const dir = desc ? -1 : 1;
  list.sort((a, b) => {
    const va = a[key];
    const vb = b[key];
    const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
    return c !== 0 ? c * dir : a.name.localeCompare(b.name);
  });
  return list;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Short label of a bucket start: "Mar 2026" for months, "Mar 3" otherwise. */
export function bucketLabel(start: string, unit: 'day' | 'week' | 'month', withYear = false): string {
  const y = start.slice(0, 4);
  const m = MONTHS[+start.slice(5, 7) - 1];
  if (unit === 'month') return `${m} ${y}`;
  const d = +start.slice(8, 10);
  return withYear ? `${m} ${d}, ${y}` : `${m} ${d}`;
}
