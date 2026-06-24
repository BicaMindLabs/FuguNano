import { describe, expect, it } from 'vitest';

import { parseGoalSpec, renderGoalTemplate } from './goal-parse.js';

describe('parseGoalSpec', () => {
  it('parses the spec fields', () => {
    const spec = parseGoalSpec(
      [
        'outcome: ship it',
        'gate: pytest -q && npm run build',
        'rubric: focus X',
        'rounds: 5',
        'allocate: manual',
      ].join('\n'),
    );
    expect(spec).toEqual({
      outcome: 'ship it',
      gate: 'pytest -q && npm run build',
      rubric: 'focus X',
      rounds: 5,
      allocate: 'manual',
    });
  });

  it('defaults rounds to 3 and allocate to auto', () => {
    const spec = parseGoalSpec('outcome: x\ngate: true');
    expect(spec.rounds).toBe(3);
    expect(spec.allocate).toBe('auto');
  });
});

describe('renderGoalTemplate', () => {
  it('emits each spec key', () => {
    const tpl = renderGoalTemplate();
    for (const key of ['outcome:', 'gate:', 'rubric:', 'rounds:', 'allocate:']) {
      expect(tpl).toContain(key);
    }
  });
});
