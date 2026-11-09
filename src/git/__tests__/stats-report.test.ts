import { describe, it, expect } from 'vitest';
import { buildStatsReport, pickTimelineUnit, renamedPath } from '../stats-report';

const rec = (hash: string, email: string, name: string, date: string, ...numstat: string[]) =>
  `\x01${hash}\x00${email}\x00${name}\x00${date}\n\n${numstat.join('\n')}\n`;

const raw =
  rec('c3', 'Bob@X.org', 'Bob', '2026-03-10T09:00:00+01:00', '5\t1\tsrc/a.ts', '-\t-\tlogo.png') +
  rec('c2', 'alice@x.org', 'Alice', '2026-03-03T14:30:00+00:00', '2\t2\tsrc/a.ts', '10\t0\tsrc/lib/b.ts') +
  rec('c1', 'bob@x.org', 'Bobby', '2026-03-02T22:00:00-05:00', '1\t0\tREADME.md') +
  rec('c0', 'bob@x.org', 'Bob', '2026-02-20T08:00:00+00:00', '3\t0\tsrc/a.ts');

describe('renamedPath', () => {
  it('keeps the new name of numstat renames', () => {
    expect(renamedPath('src/{old => new}/f.ts')).toBe('src/new/f.ts');
    expect(renamedPath('src/{ => sub}/f.ts')).toBe('src/sub/f.ts');
    expect(renamedPath('a.txt => b.txt')).toBe('b.txt');
    expect(renamedPath('plain.ts')).toBe('plain.ts');
  });
});

describe('pickTimelineUnit', () => {
  it('uses days, weeks then months as the span grows', () => {
    expect(pickTimelineUnit('2026-01-01', '2026-02-15')).toBe('day');
    expect(pickTimelineUnit('2025-01-01', '2026-01-01')).toBe('week');
    expect(pickTimelineUnit('2020-01-01', '2026-01-01')).toBe('month');
  });
});

describe('buildStatsReport', () => {
  const r = buildStatsReport(raw);

  it('totals commits, authors, lines and files', () => {
    expect(r.totals).toEqual({
      commits: 4, authors: 2, additions: 21, deletions: 3, files: 4,
      firstDate: '2026-02-20', lastDate: '2026-03-10',
    });
  });

  it('groups authors by e-mail regardless of case, naming them by their most used name', () => {
    expect(r.authors.map(a => [a.key, a.name, a.commits, a.additions, a.deletions, a.files])).toEqual([
      ['bob@x.org', 'Bob', 3, 9, 1, 3],
      ['alice@x.org', 'Alice', 1, 12, 2, 2],
    ]);
    expect(r.authors[0].names).toEqual(['Bob', 'Bobby']);
    expect(r.authors[0].firstDate).toBe('2026-02-20');
    expect(r.authors[0].lastDate).toBe('2026-03-10');
  });

  it('ranks file and folder hotspots by commits with distinct authors', () => {
    expect(r.files[0]).toEqual({ path: 'src/a.ts', commits: 3, additions: 10, deletions: 3, authors: 2 });
    // src counted once per commit (c3, c2, c0), even when 2 of its files changed in c2.
    expect(r.folders.find(f => f.path === 'src')).toEqual({ path: 'src', commits: 3, additions: 20, deletions: 3, authors: 2 });
    expect(r.folders.find(f => f.path === 'src/lib')?.commits).toBe(1);
  });

  it('builds a contiguous daily timeline, total and per author', () => {
    expect(r.timeline.unit).toBe('day');
    expect(r.timeline.starts[0]).toBe('2026-02-20');
    expect(r.timeline.starts.at(-1)).toBe('2026-03-10');
    expect(r.timeline.starts).toHaveLength(19);
    expect(r.timeline.total.reduce((a, b) => a + b, 0)).toBe(4);
    expect(r.timeline.byAuthor['alice@x.org'][r.timeline.starts.indexOf('2026-03-03')]).toBe(1);
  });

  it('fills the weekday × hour heatmap in the author time zone', () => {
    // 2026-03-02 is a Monday; 22:00 in the author's zone.
    expect(r.weekdayHour[1][22]).toBe(1);
    expect(r.weekdayHour.flat().reduce((a, b) => a + b, 0)).toBe(4);
  });

  it('lists each author top files', () => {
    expect(r.authorTopFiles['bob@x.org'][0]).toEqual({ path: 'src/a.ts', commits: 2 });
  });

  it('handles an empty log', () => {
    const e = buildStatsReport('');
    expect(e.totals.commits).toBe(0);
    expect(e.timeline.starts).toEqual([]);
  });
});
