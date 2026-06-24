import { describe, expect, it } from 'vitest';

import type {
  HarnessConfig,
  HarnessEdit,
  SplitScores,
  WeaknessCluster,
} from '../domain/self-harness.js';
import type {
  HarnessProposer,
  HarnessValidator,
  WeaknessMiner,
} from '../domain/ports/self-harness.js';
import { SelfHarnessLoop } from './self-harness-loop.js';

const baseConfig: HarnessConfig = {
  'system-prompt': 'sys',
  'memory-sources': 'mem',
  subagents: 'none',
  skills: 'none',
  bootstrap: 'boot',
  execution: 'exec',
  verification: 'verify',
  'failure-recovery': 'recover',
  'runtime-policy': 'policy',
};

const cluster: WeaknessCluster = {
  signature: { cause: 'missing artifact', causalStatus: 'causal', mechanism: 'no early artifact' },
  count: 3,
  taskKeys: ['t1', 't2', 't3'],
};

const goodEdit = (surface: HarnessEdit['surface']): HarnessEdit => ({
  surface,
  mechanism: 'no early artifact',
  after: `GOOD ${surface}`,
  rationale: 'create artifacts early',
});

const plainEdit = (surface: HarnessEdit['surface']): HarnessEdit => ({
  surface,
  mechanism: 'no early artifact',
  after: `plain ${surface}`,
  rationale: 'noop',
});

class FixedMiner implements WeaknessMiner {
  constructor(private readonly clusters: readonly WeaknessCluster[]) {}
  mine(): Promise<readonly WeaknessCluster[]> {
    return Promise.resolve(this.clusters);
  }
}

class FixedProposer implements HarnessProposer {
  constructor(private readonly edits: readonly HarnessEdit[]) {}
  propose(): Promise<readonly HarnessEdit[]> {
    return Promise.resolve(this.edits);
  }
}

class SeqProposer implements HarnessProposer {
  private call = 0;
  constructor(private readonly rounds: readonly (readonly HarnessEdit[])[]) {}
  propose(): Promise<readonly HarnessEdit[]> {
    const edits = this.rounds[this.call] ?? [];
    this.call += 1;
    return Promise.resolve(edits);
  }
}

/** Scores a config by how many surfaces contain the GOOD marker — so a GOOD edit lifts both splits. */
class MarkerValidator implements HarnessValidator {
  score(config: HarnessConfig): Promise<SplitScores> {
    const good = Object.values(config).filter((value) => value.includes('GOOD')).length;
    return Promise.resolve({ inPass: good, inTotal: 9, outPass: good, outTotal: 9 });
  }
}

describe('SelfHarnessLoop.runRound', () => {
  it('promotes an accepted edit and rejects a non-improving one', async () => {
    const loop = new SelfHarnessLoop({
      miner: new FixedMiner([cluster]),
      proposer: new FixedProposer([goodEdit('execution'), plainEdit('verification')]),
      validator: new MarkerValidator(),
      k: 2,
    });
    const result = await loop.runRound(1, 'run-1', baseConfig);

    expect(result.config.execution).toBe('GOOD execution');
    expect(result.config.verification).toBe('verify');
    expect(result.accepted.map((e) => e.surface)).toEqual(['execution']);
    expect(result.lineage).toHaveLength(2);
    expect(result.lineage.find((l) => l.surface === 'execution')?.decision).toBe('accepted');
    expect(result.lineage.find((l) => l.surface === 'verification')?.decision).toBe('rejected');
  });

  it('does nothing when there are no mined weaknesses', async () => {
    const loop = new SelfHarnessLoop({
      miner: new FixedMiner([]),
      proposer: new FixedProposer([goodEdit('execution')]),
      validator: new MarkerValidator(),
      k: 1,
    });
    const result = await loop.runRound(1, 'run-1', baseConfig);

    expect(result.config).toEqual(baseConfig);
    expect(result.accepted).toHaveLength(0);
    expect(result.lineage).toHaveLength(0);
  });

  it('shadows same-surface winners: only one promoted, the rest logged but not applied', async () => {
    const a: HarnessEdit = {
      surface: 'execution',
      mechanism: 'm',
      after: 'GOOD execution A',
      rationale: '',
    };
    const b: HarnessEdit = {
      surface: 'execution',
      mechanism: 'm',
      after: 'GOOD execution B',
      rationale: '',
    };
    const loop = new SelfHarnessLoop({
      miner: new FixedMiner([cluster]),
      proposer: new FixedProposer([a, b]),
      validator: new MarkerValidator(),
      k: 2,
    });
    const result = await loop.runRound(1, 'run-1', baseConfig);

    expect(result.accepted).toHaveLength(1);
    expect(result.config.execution).toBe('GOOD execution A'); // impact tie -> first wins (stable)
    expect(result.lineage).toHaveLength(2);
    expect(result.lineage.every((l) => l.verdict.accepted)).toBe(true); // both passed the gate
    expect(result.lineage.filter((l) => l.decision === 'accepted')).toHaveLength(1);
    expect(result.lineage.filter((l) => l.decision === 'rejected')).toHaveLength(1);
  });

  it('tracks promotion by position, not identity (duplicate proposals do not double-count)', async () => {
    const dup: HarnessEdit = {
      surface: 'execution',
      mechanism: 'm',
      after: 'GOOD execution',
      rationale: '',
    };
    const loop = new SelfHarnessLoop({
      miner: new FixedMiner([cluster]),
      proposer: new FixedProposer([dup, dup]), // same object reference twice
      validator: new MarkerValidator(),
      k: 2,
    });
    const result = await loop.runRound(1, 'run-1', baseConfig);

    expect(result.accepted).toHaveLength(1);
    expect(result.lineage).toHaveLength(2);
    expect(result.lineage.filter((l) => l.decision === 'accepted')).toHaveLength(1);
    expect(result.lineage.filter((l) => l.decision === 'rejected')).toHaveLength(1);
  });

  it('orders accepted edits by impact (highest total delta first)', async () => {
    // Two good edits on distinct surfaces both lift both splits by 1 (impact 2 each);
    // order is stable by impact, so both land and both are reported.
    const loop = new SelfHarnessLoop({
      miner: new FixedMiner([cluster]),
      proposer: new FixedProposer([goodEdit('execution'), goodEdit('verification')]),
      validator: new MarkerValidator(),
      k: 2,
    });
    const result = await loop.runRound(1, 'run-1', baseConfig);
    expect(result.config.execution).toBe('GOOD execution');
    expect(result.config.verification).toBe('GOOD verification');
    expect(result.accepted).toHaveLength(2);
  });
});

describe('SelfHarnessLoop.run (multi-round)', () => {
  it('threads the evolving config across rounds and accumulates lineage', async () => {
    const loop = new SelfHarnessLoop({
      miner: new FixedMiner([cluster]),
      proposer: new SeqProposer([[goodEdit('execution')], [goodEdit('verification')]]),
      validator: new MarkerValidator(),
      k: 1,
    });
    const out = await loop.run(2, baseConfig, (round) => `run-${String(round)}`);

    expect(out.config.execution).toBe('GOOD execution');
    expect(out.config.verification).toBe('GOOD verification');
    expect(out.lineage).toHaveLength(2);
    expect(out.lineage.map((l) => l.round)).toEqual([1, 2]);
  });
});
