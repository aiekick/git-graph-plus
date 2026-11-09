import { describe, it, expect } from 'vitest';
import { buildFullGraph } from '../../../../src/git/git-graph-builder';
import { buildSelectionTable, toCsv, toMarkdown, type ExportTable } from '../graph-export';
import type { Commit, Ref } from '../types';

const labels = {
  lane: 'Lane {n}', tag: 'Tag', description: 'Description', author: 'Author', sha: 'SHA', date: 'Date',
};

function commit(hash: string, parents: string[], refs: Ref[] = [], subject = `Commit ${hash}`): Commit {
  return {
    hash,
    abbreviatedHash: hash.slice(0, 7),
    author: { name: 'Alice', email: 'a@x', date: '2026-11-08T12:34:56+01:00' },
    committer: { name: 'Alice', email: 'a@x', date: '2026-11-08T12:34:56+01:00' },
    subject,
    body: '',
    parents,
    refs,
  };
}

function table(commits: Commit[], selected: string[]): ExportTable {
  const g = buildFullGraph(commits as never);
  return buildSelectionTable(commits, g.paths, g.dots, selected, labels);
}

// m (merge of main+feature) → f2 (feature) → m1 (main) → f1 (feature) → base
const history = [
  commit('m', ['m1', 'f2'], [{ type: 'head', name: 'main' }], 'Merge feature'),
  commit('f2', ['f1'], [{ type: 'branch', name: 'feature' }]),
  commit('m1', ['base'], [{ type: 'tag', name: 'v1.0' }]),
  commit('f1', ['base']),
  commit('base', [], [{ type: 'tag', name: 'v0.1' }, { type: 'tag', name: 'root' }]),
];

describe('buildSelectionTable', () => {
  it('has one column per lane named after its branch, then tag/description/author/sha/date', () => {
    const t = table(history, ['m', 'f2', 'm1', 'f1', 'base']);
    expect(t.headers).toEqual(['main', 'feature', 'Tag', 'Description', 'Author', 'SHA', 'Date']);
  });

  it('marks the commit lane with ● and passing lanes with │', () => {
    const t = table(history, ['m', 'f2', 'm1', 'f1', 'base']);
    expect(t.rows.map(r => r.slice(0, 2))).toEqual([
      ['●', ''],
      ['│', '●'],
      ['●', '│'],
      ['│', '●'],
      ['●', '│'],
    ]);
  });

  it('fills tag, description, author, short SHA and date', () => {
    const t = table(history, ['m1', 'base']);
    expect(t.rows[0].slice(-5)).toEqual(['v1.0', 'Commit m1', 'Alice', 'm1', '2026-11-08 12:34']);
    expect(t.rows[1][t.rows[1].length - 5]).toBe('v0.1, root');
  });

  it('only keeps lanes touching the selection and skips unselected rows', () => {
    const t = table(history, ['m']);
    expect(t.headers.slice(0, -5)).toEqual(['main']);
    expect(t.rows).toHaveLength(1);
  });

  it('falls back to "Lane n" for a lane without a branch and skips the uncommitted row', () => {
    const commits = [
      commit('UNCOMMITTED', ['a']),
      commit('a', ['b']),
      commit('b', []),
    ];
    const t = table(commits, ['UNCOMMITTED', 'a', 'b']);
    expect(t.headers[0]).toBe('Lane 1');
    expect(t.rows.map(r => r[0])).toEqual(['●', '●']);
  });
});

describe('buildSelectionTable with files', () => {
  const fileStats = {
    f2: [
      { path: 'src/parser.ts', additions: 10, deletions: 2 },
      { path: 'logo.png', additions: null, deletions: null },
    ],
    m1: [{ path: 'README.md', additions: 1, deletions: 1 }],
  };
  const g = buildFullGraph(history as never);
  const t = buildSelectionTable(history, g.paths, g.dots, ['f2', 'm1'], {
    ...labels, file: 'File', additions: 'Additions', deletions: 'Deletions',
  }, { fileStats });

  it('adds File / Additions / Deletions columns', () => {
    expect(t.headers).toEqual(['main', 'feature', 'Tag', 'Description', 'Author', 'SHA', 'Date', 'File', 'Additions', 'Deletions']);
    expect(t.numberColumns).toEqual([8, 9]);
  });

  it('puts totals on the commit line and one line per file below it', () => {
    expect(t.rows.map(r => [r[0], r[1], r[3], r[7], r[8], r[9]])).toEqual([
      ['│', '●', 'Commit f2', '', '10', '2'],
      ['│', '│', '', 'src/parser.ts', '10', '2'],
      ['│', '│', '', 'logo.png', '-', '-'],
      ['●', '│', 'Commit m1', '', '1', '1'],
      ['│', '│', '', 'README.md', '1', '1'],
    ]);
    expect(t.fileRows).toEqual([false, true, true, false, true]);
  });
});

describe('formatters', () => {
  const t: ExportTable = {
    headers: ['main', 'Description'],
    rows: [['●', 'Fix "a, b" | c']],
    laneColors: ['#63b0f4'],
    fileRows: [false],
    numberColumns: [],
  };

  it('uses ; by default and quotes fields containing quotes', () => {
    expect(toCsv(t)).toBe('main;Description\n●;"Fix ""a, b"" | c"\n');
  });

  it('honours a custom delimiter and quotes fields containing it', () => {
    expect(toCsv(t, ',')).toBe('main,Description\n●,"Fix ""a, b"" | c"\n');
    expect(toCsv({ ...t, rows: [['●', 'a;b']] })).toBe('main;Description\n●;"a;b"\n');
    expect(toCsv({ ...t, rows: [['●', 'x']] }, '\t')).toBe('main\tDescription\n●\tx\n');
  });

  it('escapes pipes in Markdown tables', () => {
    expect(toMarkdown(t)).toBe('| main | Description |\n| --- | --- |\n| ● | Fix "a, b" \\| c |\n');
  });
});
