import { describe, it, expect } from 'vitest';
import { bucketLabel, filterAndSortAuthors, periodBounds, type StatsAuthor } from '../stats';

const a = (name: string, key: string, commits: number, lastDate = '2026-01-01'): StatsAuthor => ({
  key, name, names: [name, `${name} Alt`], commits, additions: commits * 2, deletions: 0, files: 1, firstDate: '2025-01-01', lastDate,
});

describe('periodBounds', () => {
  const today = new Date(2026, 10, 9); // 2026-11-09 local
  it('counts the period back from today, today included', () => {
    expect(periodBounds('30d', today)).toEqual({ since: '2026-10-11' });
    expect(periodBounds('1y', today)).toEqual({ since: '2025-11-10' });
  });
  it('has no bounds for all, and the given ones for custom', () => {
    expect(periodBounds('all', today)).toEqual({});
    expect(periodBounds('custom', today, { from: '2026-01-01', to: '' })).toEqual({ since: '2026-01-01', until: undefined });
  });
});

describe('filterAndSortAuthors', () => {
  const list = [a('Bob', 'bob@x', 5, '2026-02-01'), a('alice', 'alice@x', 9), a('Carol', 'carol@y', 1)];
  it('sorts by a numeric column', () => {
    expect(filterAndSortAuthors(list, '', 'commits', true).map(x => x.name)).toEqual(['alice', 'Bob', 'Carol']);
    expect(filterAndSortAuthors(list, '', 'commits', false).map(x => x.name)).toEqual(['Carol', 'Bob', 'alice']);
  });
  it('sorts by text and date columns', () => {
    expect(filterAndSortAuthors(list, '', 'lastDate', true)[0].name).toBe('Bob');
    expect(filterAndSortAuthors(list, '', 'name', false).map(x => x.name)).toEqual(['alice', 'Bob', 'Carol']);
  });
  it('matches the query on names (any alias) and e-mail', () => {
    expect(filterAndSortAuthors(list, '@y', 'commits', true).map(x => x.name)).toEqual(['Carol']);
    expect(filterAndSortAuthors(list, 'bob alt', 'commits', true).map(x => x.name)).toEqual(['Bob']);
  });
});

describe('bucketLabel', () => {
  it('labels months, and days/weeks with an optional year', () => {
    expect(bucketLabel('2026-03-01', 'month')).toBe('Mar 2026');
    expect(bucketLabel('2026-03-09', 'week')).toBe('Mar 9');
    expect(bucketLabel('2026-03-09', 'day', true)).toBe('Mar 9, 2026');
  });
});
