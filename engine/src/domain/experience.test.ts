import { describe, expect, it } from 'vitest';

import { explainRecallMatch } from './experience.js';

describe('explainRecallMatch', () => {
  it('reports query score, matched terms, and stored failure cause', () => {
    const explanation = explainRecallMatch(
      {
        title: 'retrieval relabel',
        body: [
          'Failure cause:',
          'retrieval',
          '',
          'Relabeled lesson:',
          'Score dispatch output retrieval by title/body tokens.',
        ].join('\n'),
      },
      { query: 'dispatch output', failureCause: 'retrieval' },
    );

    expect(explanation).toEqual({
      score: 2,
      matchedTerms: ['dispatch', 'output'],
      failureCause: 'retrieval',
    });
  });

  it('does not treat query stop words as matched evidence', () => {
    const explanation = explainRecallMatch(
      {
        title: 'recent unrelated',
        body: 'Refresh onboarding prose.',
      },
      { query: 'the and to' },
    );

    expect(explanation).toEqual({ score: 0, matchedTerms: [] });
  });
});
