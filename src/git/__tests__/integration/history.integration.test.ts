import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { GitService } from '../../git-service';
import { TempRepo, commit, createTempRepo } from './helpers';

describe('GitService integration — file / line history', () => {
  let repo: TempRepo;
  let svc: GitService;
  let c1: string, c3: string, c5: string;

  beforeEach(() => {
    repo = createTempRepo();
    svc = new GitService(repo.path);
    c1 = commit(repo.path, 'add f', { 'f.txt': 'a\nb\nc\nd\n' });
    commit(repo.path, 'touch other', { 'other.txt': 'x\n' });
    c3 = commit(repo.path, 'edit f line 1', { 'f.txt': 'A\nb\nc\nd\n' });
    commit(repo.path, 'touch other again', { 'other.txt': 'y\n' });
    c5 = commit(repo.path, 'edit f line 4', { 'f.txt': 'A\nb\nc\nD\n' });
  });
  afterEach(() => repo.cleanup());

  it('keeps only the commits touching the file, with parents rewritten between them', async () => {
    writeFileSync(join(repo.path, 'dirty.txt'), 'untracked\n');
    const commits = await svc.log({ history: { path: 'f.txt' } });
    expect(commits.map(c => c.hash)).toEqual([c5, c3, c1]);
    expect(commits[0].parents).toEqual([c3]);
    expect(commits[1].parents).toEqual([c1]);
    // No uncommitted row in a history view.
    expect(commits.some(c => c.hash === 'UNCOMMITTED')).toBe(false);
  });

  it('keeps only the commits touching a line range', async () => {
    const commits = await svc.log({ history: { path: 'f.txt', startLine: 1, endLine: 1 } });
    expect(commits.map(c => c.hash)).toEqual([c3, c1]);
    expect(commits[0].parents).toEqual([c1]);
  });

  it('rejects an invalid line range', async () => {
    await expect(svc.log({ history: { path: 'f.txt', startLine: 3, endLine: 1 } })).rejects.toThrow();
  });

  it('searches in changes (-S) and reconnects the matches through skipped commits', async () => {
    // c1 adds "d", c5 changes "d" → "D": both change the count of "d".
    const commits = await svc.log({ contentSearch: { text: 'd', regex: false } });
    expect(commits.map(c => c.hash)).toEqual([c5, c1]);
    expect(commits[0].parents).toEqual([c1]);
    expect(commits.some(c => c.hash === 'UNCOMMITTED')).toBe(false);
  });

  it('searches changed lines with a regex (-G)', async () => {
    const commits = await svc.log({ contentSearch: { text: '^[A-Z]$', regex: true } });
    expect(commits.map(c => c.hash)).toEqual([c5, c3]);
    expect(commits[0].parents).toEqual([c3]);
  });

  it('combines a content search with a file history', async () => {
    const commits = await svc.log({ history: { path: 'other.txt' }, contentSearch: { text: 'y', regex: false } });
    expect(commits.map(c => c.subject)).toEqual(['touch other again']);
  });
});
