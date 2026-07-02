import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';

import type { Candidate, SelectorConfig, SelectorDecision } from './selector.js';
import {
  DEFAULT_SELECTOR_CONFIG,
  escalationPriority,
  route,
} from './selector.js';

const cfg = (overrides: Partial<SelectorConfig> = {}): SelectorConfig => ({
  ...DEFAULT_SELECTOR_CONFIG,
  ...overrides,
});

const labeled = (agent: string, label: string): Candidate => ({ agent, label });

describe('route — free-gate precedence', () => {
  it('gate pass is the only clean TRUST, confidence 1', () => {
    const d = route([
      { agent: 'mimo', verified: false },
      { agent: 'doubao', verified: true },
      { agent: 'stepfun', verified: false },
    ]);
    expect(d.outcome).toBe('TRUST');
    expect(d.pick).toBe('doubao');
    expect(d.reason).toBe('gate-verified');
    expect(d.confidence).toBe(1);
  });

  it('ESCALATEs when a gate ran but every candidate failed', () => {
    const d = route([
      { agent: 'a', verified: false },
      { agent: 'b', verified: false },
    ]);
    expect(d.outcome).toBe('ESCALATE');
    expect(d.reason).toBe('gate-failed');
    expect(d.pick).toBeUndefined();
  });

  it('gate result wins over label agreement AND over forced category', () => {
    const d = route(
      [
        { agent: 'a', verified: true, label: 'X' },
        { agent: 'b', verified: false, label: 'X' },
      ],
      cfg(),
      'security',
    );
    expect(d.outcome).toBe('TRUST');
    expect(d.reason).toBe('gate-verified');
  });
});

describe('route — forced-escalate categories', () => {
  it('security tasks with no gate escalate outright, ignoring unanimity', () => {
    const d = route(
      ['mimo', 'stepfun', 'doubao', 'deepseek', 'minimax'].map((a) =>
        labeled(a, 'same-answer'),
      ),
      cfg(),
      'security',
    );
    expect(d.outcome).toBe('ESCALATE');
    expect(d.reason).toBe('forced-category');
  });

  it('a category off the forced list follows the consensus path', () => {
    const d = route(
      ['a', 'b', 'c'].map((x) => labeled(x, 'A')),
      cfg(),
      'statistics',
    );
    expect(d.outcome).toBe('TRUST_SPOT_CHECK');
  });

  it('forced list is configurable', () => {
    const d = route(
      ['a', 'b', 'c'].map((x) => labeled(x, 'A')),
      cfg({ forcedEscalateCategories: [] }),
      'security',
    );
    expect(d.outcome).toBe('TRUST_SPOT_CHECK');
  });
});

describe('route — agreement path (no free gate)', () => {
  it('unanimous consensus is TRUST_SPOT_CHECK, never clean TRUST', () => {
    const d = route(
      ['mimo', 'stepfun', 'doubao', 'deepseek', 'minimax'].map((a) =>
        labeled(a, 'A'),
      ),
    );
    expect(d.outcome).toBe('TRUST_SPOT_CHECK');
    expect(d.reason).toBe('quorum');
    expect(d.agreementShare).toBe(1);
    // Laplace: (5+1)/(5+2) — small fleet never reads as certainty 1.0
    expect(d.confidence).toBeCloseTo(6 / 7);
  });

  it('4/5 majority passes the default 0.7 threshold (smoothed 5/7)', () => {
    const d = route([
      ...['a', 'b', 'c', 'd'].map((x) => labeled(x, 'A')),
      labeled('e', 'B'),
    ]);
    expect(d.outcome).toBe('TRUST_SPOT_CHECK');
    expect(d.confidence).toBeCloseTo(5 / 7);
  });

  it('3/5 majority escalates under the default threshold (smoothed 4/7)', () => {
    const d = route([
      ...['a', 'b', 'c'].map((x) => labeled(x, 'A')),
      labeled('d', 'B'),
      labeled('e', 'C'),
    ]);
    expect(d.outcome).toBe('ESCALATE');
    expect(d.reason).toBe('split');
    expect(d.confidence).toBeCloseTo(4 / 7);
  });

  it('ESCALATEs when nothing is clusterable (no labels, no gate)', () => {
    const d = route([{ agent: 'a' }, { agent: 'b' }]);
    expect(d.outcome).toBe('ESCALATE');
    expect(d.reason).toBe('split');
    expect(d.confidence).toBe(0);
  });
});

describe('route — singletons and edges', () => {
  it('ESCALATEs a lone unverified candidate by default', () => {
    const d = route([labeled('a', 'A')]);
    expect(d.outcome).toBe('ESCALATE');
    expect(d.reason).toBe('singleton');
  });

  it('a trusted singleton is still only TRUST_SPOT_CHECK', () => {
    const d = route([labeled('a', 'A')], cfg({ trustSingleton: true }));
    expect(d.outcome).toBe('TRUST_SPOT_CHECK');
    expect(d.pick).toBe('a');
    expect(d.confidence).toBeCloseTo(2 / 3);
  });

  it('ESCALATEs an empty candidate set', () => {
    const d = route([]);
    expect(d.outcome).toBe('ESCALATE');
    expect(d.reason).toBe('empty');
  });
});

describe('escalationPriority', () => {
  const dec = (
    outcome: SelectorDecision['outcome'],
    reason: SelectorDecision['reason'],
    confidence: number,
  ): SelectorDecision => ({
    outcome,
    reason,
    agreementShare: confidence,
    confidence,
  });

  it('returns escalated indices only, most-split (lowest confidence) first', () => {
    const order = escalationPriority([
      dec('TRUST', 'gate-verified', 1), // 0 — not escalated
      dec('ESCALATE', 'split', 0.57), // 1
      dec('ESCALATE', 'split', 0.4), // 2
      dec('TRUST_SPOT_CHECK', 'quorum', 0.86), // 3 — not escalated
      dec('ESCALATE', 'gate-failed', 0), // 4
    ]);
    expect(order).toEqual([4, 2, 1]);
  });

  it('at equal confidence, gate-failed and forced-category outrank splits', () => {
    const order = escalationPriority([
      dec('ESCALATE', 'split', 0.5),
      dec('ESCALATE', 'forced-category', 0.5),
      dec('ESCALATE', 'gate-failed', 0.5),
    ]);
    expect(order).toEqual([2, 1, 0]);
  });

  it('is stable for identical decisions', () => {
    const order = escalationPriority([
      dec('ESCALATE', 'split', 0.5),
      dec('ESCALATE', 'split', 0.5),
    ]);
    expect(order).toEqual([0, 1]);
  });
});

describe('route — invariants', () => {
  const rawCandidate = fc.record({
    agent: fc.string({ minLength: 1, maxLength: 4 }),
    verified: fc.option(fc.boolean(), { nil: undefined }),
    label: fc.option(fc.constantFrom('A', 'B', 'C'), { nil: undefined }),
  });

  it('verified⇒TRUST; ESCALATE⇔no pick; confidence and share stay in [0,1]', () => {
    fc.assert(
      fc.property(
        fc.array(rawCandidate, { maxLength: 8 }),
        fc.option(fc.constantFrom('security', 'statistics'), {
          nil: undefined,
        }),
        (raw, category) => {
          const candidates: Candidate[] = raw.map((r) => ({
            agent: r.agent,
            ...(r.verified !== undefined ? { verified: r.verified } : {}),
            ...(r.label !== undefined ? { label: r.label } : {}),
          }));
          const d = route(candidates, DEFAULT_SELECTOR_CONFIG, category);
          if (candidates.some((c) => c.verified === true))
            expect(d.outcome).toBe('TRUST');
          if (d.outcome === 'ESCALATE') expect(d.pick).toBeUndefined();
          else expect(d.pick).toBeDefined();
          // Clean TRUST only ever comes from a gate.
          if (d.outcome === 'TRUST') expect(d.reason).toBe('gate-verified');
          for (const v of [d.agreementShare, d.confidence]) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(1);
          }
        },
      ),
    );
  });

  it('escalationPriority output is a permutation of escalated indices', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            esc: fc.boolean(),
            confidence: fc.float({ min: 0, max: 1, noNaN: true }),
          }),
          { maxLength: 12 },
        ),
        (rows) => {
          const decisions: SelectorDecision[] = rows.map((r) => ({
            outcome: r.esc ? 'ESCALATE' : 'TRUST_SPOT_CHECK',
            reason: r.esc ? 'split' : 'quorum',
            agreementShare: r.confidence,
            confidence: r.confidence,
          }));
          const order = escalationPriority(decisions);
          const expected = decisions
            .map((d, i) => ({ d, i }))
            .filter(({ d }) => d.outcome === 'ESCALATE')
            .map(({ i }) => i);
          expect([...order].sort((a, b) => a - b)).toEqual(expected);
        },
      ),
    );
  });
});
