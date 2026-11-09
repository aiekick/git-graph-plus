import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GitService } from '../../git-service';
import { TempRepo, commit, createTempRepo, runGit } from './helpers';

describe('GitService integration — statsReport', () => {
  let repo: TempRepo;
  let svc: GitService;

  beforeEach(() => {
    repo = createTempRepo();
    svc = new GitService(repo.path);
    commit(repo.path, 'init', { 'src/a.ts': '1\n2\n', 'README.md': 'r\n' });
    commit(repo.path, 'edit a', { 'src/a.ts': '1\n2\n3\n' });
    runGit(repo.path, ['checkout', '-b', 'side']);
    commit(repo.path, 'docs', { 'docs/x.md': 'x\n' });
    runGit(repo.path, ['checkout', '-']);
  });
  afterEach(() => repo.cleanup());

  it('reports every ref by default and only the chosen branch otherwise', async () => {
    expect((await svc.statsReport({ scope: 'all' })).totals.commits).toBe(3);
    expect((await svc.statsReport({ scope: 'current' })).totals.commits).toBe(2);
    expect((await svc.statsReport({ scope: 'side' })).totals.commits).toBe(3);
  });

  it('limits to a path and counts its lines', async () => {
    const r = await svc.statsReport({ scope: 'all', path: 'src' });
    expect(r.totals).toMatchObject({ commits: 2, additions: 3, deletions: 0, files: 1 });
    expect(r.files[0].path).toBe('src/a.ts');
  });

  it('limits to a period and rejects malformed dates', async () => {
    expect((await svc.statsReport({ scope: 'all', since: '2999-01-01' })).totals.commits).toBe(0);
    await expect(svc.statsReport({ scope: 'all', since: 'yesterday' })).rejects.toThrow();
  });
});
