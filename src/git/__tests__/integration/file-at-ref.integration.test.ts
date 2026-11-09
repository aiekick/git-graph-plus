import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { GitService } from '../../git-service';
import { TempRepo, commit, createTempRepo, runGit } from './helpers';

const lines = (n: number, edit?: (i: number) => string | null) =>
  Array.from({ length: n }, (_, i) => (edit ? edit(i + 1) : null) ?? `L${i + 1}`).join('\n') + '\n';

describe('GitService integration — file at a revision', () => {
  let repo: TempRepo;
  let svc: GitService;

  beforeEach(() => {
    repo = createTempRepo();
    svc = new GitService(repo.path);
  });
  afterEach(() => repo.cleanup());

  it('reads a file at a commit, in the index and on disk', async () => {
    const first = commit(repo.path, 'first', { 'a.txt': 'one\n' });
    commit(repo.path, 'second', { 'a.txt': 'two\n' });
    writeFileSync(join(repo.path, 'a.txt'), 'three\n');
    runGit(repo.path, ['add', 'a.txt']);
    writeFileSync(join(repo.path, 'a.txt'), 'four\n');

    expect(await svc.readFileAtRef(first, 'a.txt')).toBe('one\n');
    expect(await svc.readFileAtRef('HEAD', 'a.txt')).toBe('two\n');
    expect(await svc.readFileAtRef('index', 'a.txt')).toBe('three\n');
    expect(await svc.readFileAtRef('working', 'a.txt')).toBe('four\n');
  });

  it('rejects paths escaping the repo', async () => {
    commit(repo.path, 'init', { 'a.txt': 'x\n' });
    await expect(svc.readFileAtRef('working', '../etc/passwd')).rejects.toThrow();
    await expect(svc.readFileAtRef('HEAD', '/etc/passwd')).rejects.toThrow();
  });

  it('maps a line of an old revision onto the working file', async () => {
    const old = commit(repo.path, 'base', { 'f.txt': lines(50) });
    // Since then: 3 lines inserted after line 5, line 20 deleted.
    commit(repo.path, 'later', {
      'f.txt': lines(50, i => (i === 5 ? 'L5\nN1\nN2\nN3' : i === 20 ? '' : null)).replace('\n\n', '\n'),
    });
    expect(await svc.mapLineToWorkingTree(old, 'f.txt', 3)).toBe(3);
    expect(await svc.mapLineToWorkingTree(old, 'f.txt', 10)).toBe(13);
    expect(await svc.mapLineToWorkingTree(old, 'f.txt', 30)).toBe(32);
    expect(await svc.mapLineToWorkingTree('working', 'f.txt', 30)).toBe(30);
  });

  it('restores files in the working tree from a revision, deleting those absent there', async () => {
    const before = commit(repo.path, 'before', { 'a.txt': 'a1\n', 'b.txt': 'b1\n' });
    const added = commit(repo.path, 'add c, edit a', { 'a.txt': 'a2\n', 'c.txt': 'c\n' });
    writeFileSync(join(repo.path, 'a.txt'), 'local edit\n');

    const res = await svc.restoreFilesFromRef(before, ['a.txt', 'c.txt']);
    expect(res).toEqual({ restored: ['a.txt'], deleted: ['c.txt'] });
    expect(readFileSync(join(repo.path, 'a.txt'), 'utf8')).toBe('a1\n');
    expect(existsSync(join(repo.path, 'c.txt'))).toBe(false);
    // Index untouched: a.txt still staged as in HEAD.
    expect(runGit(repo.path, ['show', ':a.txt'])).toBe('a2\n');

    await svc.restoreFilesFromRef(added, ['c.txt']);
    expect(readFileSync(join(repo.path, 'c.txt'), 'utf8')).toBe('c\n');
  });
});
