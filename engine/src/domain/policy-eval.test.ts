import { describe, expect, it } from 'vitest';

import { isGo } from './gate.js';
import type { Selection } from './policy.js';
import {
  DEFAULT_POLICIES,
  evaluatePolicies,
  generationNotReviewPolicy,
  noGeminiPolicy,
  policyResultToGate,
  reviewerRequiredPolicy,
} from './policy-eval.js';

describe('noGeminiPolicy', () => {
  it('fails any implementer / reviewer / harness in the Gemini family (case-insensitive)', () => {
    const sel: Selection = {
      implementers: ['deepseek', 'Gemini-pro'],
      reviewer: 'codex',
      harness: 'fugue-cc',
    };
    const v = noGeminiPolicy.evaluate(sel);
    expect(v).toHaveLength(1);
    expect(v[0]?.severity).toBe('fail');
    expect(v[0]?.detail).toMatch(/implementer/u);

    expect(noGeminiPolicy.evaluate({ implementers: ['x'], reviewer: 'antigravity' })).toHaveLength(
      1,
    );
    expect(noGeminiPolicy.evaluate({ implementers: ['x'], harness: 'GEMINI' })).toHaveLength(1);
  });

  it('passes a clean selection', () => {
    expect(
      noGeminiPolicy.evaluate({ implementers: ['deepseek', 'glm'], reviewer: 'codex' }),
    ).toHaveLength(0);
  });
});

describe('generationNotReviewPolicy', () => {
  it('fails when the reviewer is also an implementer', () => {
    const v = generationNotReviewPolicy.evaluate({
      implementers: ['deepseek', 'codex'],
      reviewer: 'codex',
    });
    expect(v).toHaveLength(1);
    expect(v[0]?.severity).toBe('fail');
  });

  it('passes when reviewer is independent', () => {
    expect(
      generationNotReviewPolicy.evaluate({ implementers: ['deepseek'], reviewer: 'codex' }),
    ).toHaveLength(0);
  });
});

describe('reviewerRequiredPolicy', () => {
  it('warns when no reviewer is set', () => {
    const v = reviewerRequiredPolicy.evaluate({ implementers: ['deepseek'] });
    expect(v).toHaveLength(1);
    expect(v[0]?.severity).toBe('warn');
  });

  it('is silent when a reviewer is set', () => {
    expect(
      reviewerRequiredPolicy.evaluate({ implementers: ['deepseek'], reviewer: 'codex' }),
    ).toHaveLength(0);
  });
});

describe('evaluatePolicies + policyResultToGate', () => {
  it('a clean selection passes all default policies and is GO', () => {
    const result = evaluatePolicies(DEFAULT_POLICIES, {
      implementers: ['deepseek', 'glm'],
      reviewer: 'codex',
    });
    expect(result.violations).toHaveLength(0);
    expect(isGo(policyResultToGate(result))).toBe(true);
  });

  it('a no-Gemini violation makes the gate NO-GO', () => {
    const result = evaluatePolicies(DEFAULT_POLICIES, {
      implementers: ['gemini-2.5'],
      reviewer: 'codex',
    });
    expect(isGo(policyResultToGate(result))).toBe(false);
  });

  it('a missing reviewer warns but stays GO', () => {
    const result = evaluatePolicies(DEFAULT_POLICIES, { implementers: ['deepseek'] });
    const gate = policyResultToGate(result);
    expect(result.violations.every((v) => v.severity === 'warn')).toBe(true);
    expect(isGo(gate)).toBe(true);
  });
});
