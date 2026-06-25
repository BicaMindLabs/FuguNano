import { describe, expect, it } from 'vitest';

import type { Ownership } from '../../domain/ownership.js';
import type { VcsPort } from '../../domain/ports/vcs.js';
import { err, ok } from '../../domain/result.js';
import type { Result } from '../../domain/result.js';
import type { Identity, VcsError, Worktree } from '../../domain/vcs.js';
import { allClean } from '../../domain/vcs.js';
import { DefaultIntegrator } from './default-integrator.js';

const ID: Identity = { name: 'fuguectl', email: 'fuguectl@local' };

interface Script {
  readonly changed?: Readonly<Record<string, readonly string[]>>; // by worktree path
  readonly commit?: Readonly<Record<string, Result<string, VcsError>>>; // by worktree path
  readonly pick?: Readonly<Record<string, Result<void, VcsError>>>; // by sha
}

class FakeVcs implements VcsPort {
  readonly committed: string[] = [];
  constructor(private readonly script: Script = {}) {}
  changedFiles(worktree: string): Promise<readonly string[]> {
    return Promise.resolve(this.script.changed?.[worktree] ?? []);
  }
  commitAll(worktree: string): Promise<Result<string, VcsError>> {
    this.committed.push(worktree);
    return Promise.resolve(this.script.commit?.[worktree] ?? ok(`sha-${worktree}`));
  }
  cherryPick(_repo: string, sha: string): Promise<Result<void, VcsError>> {
    return Promise.resolve(this.script.pick?.[sha] ?? ok(undefined));
  }
}

const wt = (agent: string): Worktree => ({ agent, path: `/wt/${agent}` });

describe('DefaultIntegrator', () => {
  it('integrates clean worktrees', async () => {
    const report = await new DefaultIntegrator(new FakeVcs(), ID).integrate('/repo', [
      wt('a'),
      wt('b'),
    ]);
    expect(report.results.map((r) => r.outcome)).toEqual(['picked', 'picked']);
    expect(allClean(report)).toBe(true);
  });

  it('reports nochange when a worktree has nothing to commit', async () => {
    const vcs = new FakeVcs({ commit: { '/wt/a': err({ kind: 'no-commit', detail: 'empty' }) } });
    const report = await new DefaultIntegrator(vcs, ID).integrate('/repo', [wt('a')]);
    expect(report.results[0]?.outcome).toBe('nochange');
  });

  it('isolates a conflict — the other agents still land', async () => {
    const vcs = new FakeVcs({
      pick: { 'sha-/wt/b': err({ kind: 'conflict', detail: 'CONFLICT' }) },
    });
    const report = await new DefaultIntegrator(vcs, ID).integrate('/repo', [
      wt('a'),
      wt('b'),
      wt('c'),
    ]);
    expect(report.results.map((r) => `${r.agent}:${r.outcome}`)).toEqual([
      'a:picked',
      'b:conflict',
      'c:picked',
    ]);
    expect(allClean(report)).toBe(false);
  });

  it('withholds an out-of-bounds agent before committing it (ownership)', async () => {
    const ownership: Ownership = new Map([['rogue', { owned: ['src/*'], forbidden: [] }]]);
    const vcs = new FakeVcs({ changed: { '/wt/rogue': ['README.md'], '/wt/ok': ['src/a.ts'] } });
    const report = await new DefaultIntegrator(vcs, ID).integrate(
      '/repo',
      [wt('rogue'), wt('ok')],
      { ownership },
    );

    const rogue = report.results.find((r) => r.agent === 'rogue');
    expect(rogue?.outcome).toBe('violation');
    expect(rogue?.violatingFiles).toEqual(['README.md']);
    expect(vcs.committed).not.toContain('/wt/rogue'); // never committed
    expect(report.results.find((r) => r.agent === 'ok')?.outcome).toBe('picked');
  });
});
