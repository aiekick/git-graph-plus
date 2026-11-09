import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GitService } from '../../git-service';
import { TempRepo, commit, createTempRepo, runGit, seedBranches } from './helpers';

describe('GitService integration — commitFileStats', () => {
  let repo: TempRepo;
  let svc: GitService;

  beforeEach(() => {
    repo = createTempRepo();
    svc = new GitService(repo.path);
  });
  afterEach(() => repo.cleanup());

  it('lists added/deleted lines per file for each commit, root included', async () => {
    const root = commit(repo.path, 'init', { 'a.txt': '1\n2\n3\n' });
    const edit = commit(repo.path, 'edit', { 'a.txt': '1\nX\n', 'é dir/b.txt': 'b\n' });

    const stats = await svc.commitFileStats([edit, root]);
    expect(stats[root]).toEqual([{ path: 'a.txt', additions: 3, deletions: 0 }]);
    expect(stats[edit]).toEqual([
      { path: 'a.txt', additions: 1, deletions: 2 },
      { path: 'é dir/b.txt', additions: 1, deletions: 0 },
    ]);
  });

  it('compares a merge with its first parent', async () => {
    seedBranches(repo.path);
    runGit(repo.path, ['merge', '--no-ff', '-m', 'merge feature', 'feature']);
    const merge = runGit(repo.path, ['rev-parse', 'HEAD']).trim();

    const stats = await svc.commitFileStats([merge]);
    expect(stats[merge].map(f => f.path).sort()).toEqual(['feature1.txt', 'feature2.txt']);
  });

  it('reports binary files with null counts and empty commits with no files', async () => {
    commit(repo.path, 'init', { 'a.txt': 'a\n' });
    runGit(repo.path, ['commit', '--allow-empty', '-m', 'empty']);
    const empty = runGit(repo.path, ['rev-parse', 'HEAD']).trim();
    const bin = commit(repo.path, 'bin', { 'img.bin': 'a\u0000b\u0000c' });

    const stats = await svc.commitFileStats([empty, bin]);
    expect(stats[empty]).toEqual([]);
    expect(stats[bin]).toEqual([{ path: 'img.bin', additions: null, deletions: null }]);
  });
});
