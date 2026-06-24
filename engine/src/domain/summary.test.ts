import { describe, expect, it } from 'vitest';

import type { RoundManifest } from './round.js';
import { renderSummary } from './summary.js';

const manifest: RoundManifest = {
  round: 2,
  expected: ['a', 'b', 'c'],
  states: { a: 'done', b: 'fail', c: 'pending' },
};

describe('renderSummary', () => {
  it('lists per-key state and a tally', () => {
    const out = renderSummary(manifest);
    expect(out).toContain('## Round 2 summary');
    expect(out).toContain('- a: done');
    expect(out).toContain('- c: pending');
    expect(out).toContain('done 1 / fail 1 / timeout 0 / canceled 0 / pending 1 (of 3)');
  });

  it('includes elapsed when provided', () => {
    expect(renderSummary(manifest, 5_000)).toContain('elapsed: 5s');
  });
});
