import { describe, expect, it } from 'vitest';

import type { Catalog } from './skill.js';
import { classifyType, matchSkills, parseDescription, renderInjection } from './skill-parse.js';

describe('parseDescription', () => {
  it('reads an inline description', () => {
    expect(parseDescription('---\nname: x\ndescription: a quick tool\n---\nbody')).toBe(
      'a quick tool',
    );
  });

  it('joins a folded (>-) multi-line description and collapses whitespace', () => {
    const md = [
      '---',
      'description: >-',
      '  first part',
      '  second part',
      'name: x',
      '---',
      'body',
    ].join('\n');
    expect(parseDescription(md)).toBe('first part second part');
  });

  it('truncates to 160 chars', () => {
    const long = 'x'.repeat(200);
    const out = parseDescription(`---\ndescription: ${long}\n---`);
    expect(out.length).toBe(160);
    expect(out.endsWith('...')).toBe(true);
  });

  it('is empty when there is no description', () => {
    expect(parseDescription('---\nname: x\n---\nbody')).toBe('');
  });
});

describe('classifyType', () => {
  it('marks note-prefixed ids as notes, others functional', () => {
    expect(classifyType('wdkns-foo')).toBe('note');
    expect(classifyType('book-bar')).toBe('note');
    expect(classifyType('fugue')).toBe('functional');
  });
});

const catalog: Catalog = [
  {
    id: 'fugue',
    source: 'user',
    type: 'functional',
    path: 'a',
    description: 'parallelize work across agents',
  },
  { id: 'pdf', source: 'user', type: 'functional', path: 'b', description: 'pdf tools' },
  { id: 'book-x', source: 'user', type: 'note', path: 'c', description: 'book note about agents' },
];

describe('matchSkills', () => {
  it('filters by query and ranks by hit count', () => {
    const out = matchSkills(catalog, 'agents');
    expect(out.map((r) => r.id)).toEqual(['book-x', 'fugue']); // both hit once; tie broken by id asc
  });

  it('respects type and limit', () => {
    expect(matchSkills(catalog, 'agents', { type: 'functional' }).map((r) => r.id)).toEqual([
      'fugue',
    ]);
    expect(matchSkills(catalog, 'agents', { limit: 1 })).toHaveLength(1);
  });
});

describe('renderInjection', () => {
  it('emits a header, one line per skill, and a footer', () => {
    const out = renderInjection([
      {
        id: 'fugue',
        source: 'user',
        type: 'functional',
        path: 'a',
        description: 'parallelize work across agents',
      },
    ]);
    expect(out).toContain('[Skills available for this task');
    expect(out).toContain('- fugue (a): parallelize work across agents');
    expect(out).toContain('Invoke a needed skill');
  });
});
