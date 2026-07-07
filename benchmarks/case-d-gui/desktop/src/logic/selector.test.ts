import { describe, expect, it } from 'vitest';

import type { Candidate } from './selector';
import { outcomeExit, routePreview } from './selector';

// Drift guard: routePreview() is a hand-vendored mirror of engine/src/domain/selector.ts::route().
// These golden cases pin the mirror to the engine's documented behaviour — precedence
// (gate → forced-category → smoothed consensus), (k+1)/(n+2) smoothing, and the
// trustThreshold=0.7 / trustSingleton=false defaults. If the engine's route() changes, update
// selector.ts AND these expectations together.

const labeled = (agent: string, label: string): Candidate => ({ agent, label });

describe('routePreview — free-gate precedence', () => {
  it('a verified candidate is the only clean TRUST, confidence 1', () => {
    const d = routePreview([
      { agent: 'mimo', verified: false },
      { agent: 'doubao', verified: true },
      { agent: 'stepfun', verified: false },
    ]);
    expect(d.outcome).toBe('TRUST');
    expect(d.pick).toBe('doubao');
    expect(d.reason).toBe('gate-verified');
    expect(d.confidence).toBe(1);
    expect(outcomeExit(d.outcome)).toBe(0);
  });

  it('a gate that ran but passed nobody ESCALATEs (gate-failed)', () => {
    const d = routePreview([
      { agent: 'a', verified: false },
      { agent: 'b', verified: false },
    ]);
    expect(d.outcome).toBe('ESCALATE');
    expect(d.reason).toBe('gate-failed');
    expect(d.pick).toBeUndefined();
  });

  it('a verified gate wins over both label agreement and a forced category', () => {
    const d = routePreview(
      [
        { agent: 'a', verified: true, label: 'X' },
        { agent: 'b', label: 'X' },
      ],
      undefined,
      'security',
    );
    expect(d.outcome).toBe('TRUST');
    expect(d.reason).toBe('gate-verified');
  });
});

describe('routePreview — forced-escalate categories', () => {
  it('escalates a forced category when no gate vouches', () => {
    const d = routePreview([labeled('a', 'X'), labeled('b', 'X'), labeled('c', 'X')], undefined, 'security');
    expect(d.outcome).toBe('ESCALATE');
    expect(d.reason).toBe('forced-category');
    expect(outcomeExit(d.outcome)).toBe(20);
  });

  it('a non-forced category falls through to the agreement path', () => {
    const d = routePreview([labeled('a', 'X'), labeled('b', 'X'), labeled('c', 'X')], undefined, 'ui');
    expect(d.outcome).toBe('TRUST_SPOT_CHECK');
    expect(d.reason).toBe('quorum');
  });
});

describe('routePreview — smoothed consensus', () => {
  it('unanimous 5/5 → TRUST_SPOT_CHECK, confidence 6/7', () => {
    const d = routePreview(['a', 'b', 'c', 'd', 'e'].map((a) => labeled(a, 'X')));
    expect(d.outcome).toBe('TRUST_SPOT_CHECK');
    expect(d.reason).toBe('quorum');
    expect(d.confidence).toBeCloseTo(6 / 7, 5);
    expect(outcomeExit(d.outcome)).toBe(10);
  });

  it('4/5 majority just passes the 0.7 threshold (5/7 ≈ 0.714)', () => {
    const d = routePreview([
      labeled('a', 'X'),
      labeled('b', 'X'),
      labeled('c', 'X'),
      labeled('d', 'X'),
      labeled('e', 'Y'),
    ]);
    expect(d.outcome).toBe('TRUST_SPOT_CHECK');
    expect(d.confidence).toBeCloseTo(5 / 7, 5);
  });

  it('3/5 split falls below threshold (4/7 ≈ 0.571) → ESCALATE split', () => {
    const d = routePreview([
      labeled('a', 'X'),
      labeled('b', 'X'),
      labeled('c', 'X'),
      labeled('d', 'Y'),
      labeled('e', 'Z'),
    ]);
    expect(d.outcome).toBe('ESCALATE');
    expect(d.reason).toBe('split');
    expect(d.confidence).toBeCloseTo(4 / 7, 5);
  });

  it('a lone unverified candidate ESCALATEs (singleton) by default', () => {
    const d = routePreview([labeled('a', 'X')]);
    expect(d.outcome).toBe('ESCALATE');
    expect(d.reason).toBe('singleton');
  });

  it('no labels and no gate → ESCALATE split', () => {
    const d = routePreview([{ agent: 'a' }, { agent: 'b' }]);
    expect(d.outcome).toBe('ESCALATE');
    expect(d.reason).toBe('split');
  });

  it('empty candidate set → ESCALATE empty', () => {
    const d = routePreview([]);
    expect(d.outcome).toBe('ESCALATE');
    expect(d.reason).toBe('empty');
  });
});
