import { describe, expect, it } from 'vitest';

import { explainRecallMatch, renderExperienceMethod } from './experience.js';

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
      sourceKind: 'manual',
      trustKind: 'trusted',
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

    expect(explanation).toEqual({
      score: 0,
      matchedTerms: [],
      sourceKind: 'manual',
      trustKind: 'trusted',
    });
  });

  it('includes the active minimum score gate when provided', () => {
    const explanation = explainRecallMatch(
      {
        title: 'dispatch retrieval',
        body: 'Use dispatch output anchors.',
      },
      { query: 'dispatch output anchors', minScore: 2 },
    );

    expect(explanation).toEqual({
      score: 3,
      matchedTerms: ['dispatch', 'output', 'anchors'],
      sourceKind: 'manual',
      trustKind: 'trusted',
      minScore: 2,
    });
  });

  it('reports stored provenance when available', () => {
    const explanation = explainRecallMatch(
      {
        title: 'task-derived retro',
        body: 'Use source task provenance in recall audits.',
        sourceKind: 'task',
        sourceRef: '/tmp/TASK.md',
        trustKind: 'trusted',
      },
      { query: 'source task provenance' },
    );

    expect(explanation).toEqual({
      score: 3,
      matchedTerms: ['source', 'task', 'provenance'],
      sourceKind: 'task',
      sourceRef: '/tmp/TASK.md',
      trustKind: 'trusted',
    });
  });

  it('includes the active source filter when provided', () => {
    const explanation = explainRecallMatch(
      {
        title: 'task-derived retro',
        body: 'Use task provenance in recall audits.',
        sourceKind: 'task',
        sourceRef: '/tmp/TASK.md',
        trustKind: 'trusted',
      },
      { query: 'task provenance', sourceKind: 'task' },
    );

    expect(explanation).toEqual({
      score: 2,
      matchedTerms: ['task', 'provenance'],
      sourceKind: 'task',
      sourceRef: '/tmp/TASK.md',
      trustKind: 'trusted',
      sourceFilter: 'task',
    });
  });

  it('includes the active source reference filter when provided', () => {
    const explanation = explainRecallMatch(
      {
        title: 'task-derived retro',
        body: 'Use task provenance in recall audits.',
        sourceKind: 'task',
        sourceRef: '/tmp/TASK.md',
        trustKind: 'trusted',
      },
      { query: 'task provenance', sourceKind: 'task', sourceRef: '/tmp/TASK.md' },
    );

    expect(explanation).toEqual({
      score: 2,
      matchedTerms: ['task', 'provenance'],
      sourceKind: 'task',
      sourceRef: '/tmp/TASK.md',
      trustKind: 'trusted',
      sourceFilter: 'task',
      sourceRefFilter: '/tmp/TASK.md',
    });
  });

  it('reports stored trust and the active trust filter', () => {
    const explanation = explainRecallMatch(
      {
        title: 'web imported note',
        body: 'Treat browser-provided memory as untrusted until reviewed.',
        sourceKind: 'manual',
        trustKind: 'untrusted',
      },
      { query: 'browser memory', trust: 'untrusted' },
    );

    expect(explanation).toEqual({
      score: 2,
      matchedTerms: ['browser', 'memory'],
      sourceKind: 'manual',
      trustKind: 'untrusted',
      trustFilter: 'untrusted',
    });
  });

  it('includes the active max-age gate when provided', () => {
    const explanation = explainRecallMatch(
      {
        title: 'fresh route',
        body: 'Prefer recent routing lessons.',
      },
      { query: 'recent routing', maxAgeSeconds: 86_400 },
    );

    expect(explanation).toEqual({
      score: 2,
      matchedTerms: ['recent', 'routing'],
      sourceKind: 'manual',
      trustKind: 'trusted',
      maxAgeSeconds: 86_400,
    });
  });

  it('includes the active superseded audit mode when provided', () => {
    const explanation = explainRecallMatch(
      {
        title: 'fresh route',
        body: 'Prefer corrected routing lessons.',
      },
      { query: 'corrected routing', includeSuperseded: true },
    );

    expect(explanation).toEqual({
      score: 2,
      matchedTerms: ['corrected', 'routing'],
      sourceKind: 'manual',
      trustKind: 'trusted',
      includeSuperseded: true,
    });
  });
});

describe('renderExperienceMethod', () => {
  it('renders provenance-bearing metadata before the recalled body', () => {
    expect(
      renderExperienceMethod({
        workspace: 'code',
        title: 'retrieval relabel',
        slug: 'retrieval-relabel',
        created: 123,
        sourceKind: 'task',
        sourceRef: '/tmp/TASK.md',
        trustKind: 'trusted',
        supersedes: ['old-route'],
        body: ['Failure cause:', 'retrieval', '', 'Prefer title/body query terms.'].join('\n'),
      }),
    ).toBe(
      [
        '[experience] retrieval relabel',
        '[experience:meta] {"slug":"retrieval-relabel","sourceKind":"task","sourceRef":"/tmp/TASK.md","trustKind":"trusted","created":123,"failureCause":"retrieval","supersedes":["old-route"]}',
        'Failure cause:',
        'retrieval',
        '',
        'Prefer title/body query terms.',
        '',
      ].join('\n'),
    );
  });

  it('uses manual source metadata for legacy-style records', () => {
    expect(
      renderExperienceMethod({
        workspace: 'code',
        title: 'fast path',
        slug: 'fast-path',
        created: 7,
        sourceKind: 'manual',
        trustKind: 'trusted',
        body: 'Reuse this method.',
      }),
    ).toContain(
      '[experience:meta] {"slug":"fast-path","sourceKind":"manual","trustKind":"trusted","created":7}',
    );
  });

  it('keeps source references parse-stable when they contain spaces or key-like text', () => {
    const rendered = renderExperienceMethod({
      workspace: 'code',
      title: 'browser note',
      slug: 'browser-note',
      created: 9,
      sourceKind: 'manual',
      sourceRef: 'browser note trust=untrusted',
      trustKind: 'untrusted',
      body: 'Treat as imported.',
    });

    expect(rendered).toContain(
      '[experience:meta] {"slug":"browser-note","sourceKind":"manual","sourceRef":"browser note trust=untrusted","trustKind":"untrusted","created":9}',
    );
  });
});
