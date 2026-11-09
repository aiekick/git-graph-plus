import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GitService } from '../../git-service';
import { TempRepo, createTempRepo, seedBranches } from './helpers';

describe('GitService integration — hidden branches', () => {
  let repo: TempRepo;
  let svc: GitService;

  beforeEach(() => {
    repo = createTempRepo();
    svc = new GitService(repo.path);
  });
  afterEach(() => repo.cleanup());

  it('leaves out the commits only reachable from a hidden branch and its label', async () => {
    const { featureTip } = seedBranches(repo.path);
    const all = await svc.log();
    expect(all.some(c => c.hash === featureTip)).toBe(true);

    const hidden = await svc.log({ hiddenRefs: ['refs/heads/feature'] });
    expect(hidden.some(c => c.hash === featureTip)).toBe(false);
    expect(hidden.some(c => c.subject === 'feature first')).toBe(false);
    // Shared history and the other branch stay.
    expect(hidden.some(c => c.subject === 'main second')).toBe(true);
    expect(hidden.flatMap(c => c.refs).some(r => r.name === 'feature')).toBe(false);
  });

  it('rejects anything but a branch ref', async () => {
    seedBranches(repo.path);
    await expect(svc.log({ hiddenRefs: ['--all'] })).rejects.toThrow();
    await expect(svc.log({ hiddenRefs: ['refs/tags/v1'] })).rejects.toThrow();
  });
});
