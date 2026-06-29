import { describe, expect, it } from 'vitest';

import { normalizeOption, splitCsv } from './param-parse.js';

describe('splitCsv', () => {
  it('trims parts and drops empties', () => {
    expect(splitCsv(' a , b ,,c ')).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty list for blank input', () => {
    expect(splitCsv('')).toEqual([]);
    expect(splitCsv(' , , ')).toEqual([]);
  });
});

describe('normalizeOption', () => {
  it('trims and lowercases', () => {
    expect(normalizeOption('  Codex  ')).toBe('codex');
  });

  it('passes undefined through', () => {
    expect(normalizeOption(undefined)).toBeUndefined();
  });

  it('preserves an empty string after trim', () => {
    expect(normalizeOption('   ')).toBe('');
  });
});
