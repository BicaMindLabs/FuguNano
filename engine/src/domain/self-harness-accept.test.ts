import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  acceptEdit,
  applyEdit,
  clusterWeaknesses,
  mergeAccepted,
  totalDelta,
} from './self-harness-accept.js';
import type {
  FailureSignature,
  HarnessConfig,
  HarnessEdit,
  SplitScores,
  TaggedFailure,
} from './self-harness.js';

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

const scores = (inPass: number, outPass: number): SplitScores => ({
  inPass,
  inTotal: 10,
  outPass,
  outTotal: 10,
});

const edit = (surface: HarnessEdit['surface'], after: string): HarnessEdit => ({
  surface,
  mechanism: 'm',
  after,
  rationale: 'r',
});

describe('acceptEdit (non-regression gate)', () => {
  it('accepts an edit that improves one split and holds the other', () => {
    expect(acceptEdit(scores(5, 5), scores(6, 5)).accepted).toBe(true);
    expect(acceptEdit(scores(5, 5), scores(5, 7)).accepted).toBe(true);
    expect(acceptEdit(scores(5, 5), scores(6, 6)).accepted).toBe(true);
  });

  it('rejects a trade-off (one split up, the other down) even if the total rises', () => {
    expect(acceptEdit(scores(5, 5), scores(8, 4)).accepted).toBe(false);
  });

  it('rejects a no-op (no split improves)', () => {
    expect(acceptEdit(scores(5, 5), scores(5, 5)).accepted).toBe(false);
  });

  it('reports the split deltas', () => {
    const verdict = acceptEdit(scores(3, 4), scores(5, 4));
    expect(verdict.deltaIn).toBe(2);
    expect(verdict.deltaOut).toBe(0);
    expect(totalDelta(verdict)).toBe(2);
  });

  it('property: accepted iff both deltas >= 0 and at least one > 0', () => {
    const n = fc.integer({ min: 0, max: 30 });
    fc.assert(
      fc.property(n, n, n, n, (ci, co, ni, no) => {
        const verdict = acceptEdit(scores(ci, co), scores(ni, no));
        const di = ni - ci;
        const dout = no - co;
        expect(verdict.deltaIn).toBe(di);
        expect(verdict.deltaOut).toBe(dout);
        expect(verdict.accepted).toBe(di >= 0 && dout >= 0 && Math.max(di, dout) > 0);
      }),
    );
  });

  it('throws when split totals differ (must score identical fixed splits)', () => {
    const current: SplitScores = { inPass: 5, inTotal: 10, outPass: 5, outTotal: 10 };
    const candidate: SplitScores = { inPass: 6, inTotal: 12, outPass: 5, outTotal: 10 };
    expect(() => acceptEdit(current, candidate)).toThrow(/split totals must match/u);
  });
});

describe('applyEdit', () => {
  it('replaces only the target surface and leaves the source config untouched', () => {
    const next = applyEdit(baseConfig, edit('execution', 'NEW'));
    expect(next.execution).toBe('NEW');
    expect(next['system-prompt']).toBe('sys');
    expect(baseConfig.execution).toBe('exec');
  });
});

describe('clusterWeaknesses', () => {
  const sig = (mechanism: string): FailureSignature => ({
    cause: 'missing artifact',
    causalStatus: 'causal',
    mechanism,
  });

  it('groups by exact signature and orders by descending count', () => {
    const failures: readonly TaggedFailure[] = [
      { taskKey: 't1', signature: sig('alpha') },
      { taskKey: 't2', signature: sig('beta') },
      { taskKey: 't3', signature: sig('beta') },
    ];
    const clusters = clusterWeaknesses(failures);
    expect(clusters.map((c) => [c.signature.mechanism, c.count])).toEqual([
      ['beta', 2],
      ['alpha', 1],
    ]);
    expect(clusters[0]?.taskKeys).toEqual(['t2', 't3']);
  });

  it('breaks count ties by mechanism code point', () => {
    const clusters = clusterWeaknesses([
      { taskKey: 'x', signature: sig('zeta') },
      { taskKey: 'y', signature: sig('alpha') },
    ]);
    expect(clusters.map((c) => c.signature.mechanism)).toEqual(['alpha', 'zeta']);
  });
});

describe('mergeAccepted', () => {
  it('applies edits to distinct surfaces', () => {
    const merged = mergeAccepted(baseConfig, [edit('execution', 'E'), edit('verification', 'V')]);
    expect(merged.execution).toBe('E');
    expect(merged.verification).toBe('V');
  });

  it('keeps the first edit when two target the same surface', () => {
    const merged = mergeAccepted(baseConfig, [
      edit('execution', 'FIRST'),
      edit('execution', 'SECOND'),
    ]);
    expect(merged.execution).toBe('FIRST');
  });
});
