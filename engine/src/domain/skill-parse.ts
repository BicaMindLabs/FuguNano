import type { Catalog, SkillRef, SkillSourceKind, SkillType } from './skill.js';
import { DEFAULT_NOTE_RE } from './skill.js';

/**
 * Extract `description` from a SKILL.md frontmatter (faithful port of the bash
 * awk): inline `description: x`, or a folded/empty `>`/`|`/blank value whose
 * following indented lines are joined. Whitespace-collapsed, truncated to 160.
 */
export const parseDescription = (content: string): string => {
  const lines = content.split(/\r?\n/u);
  let frontDelims = 0;
  let inFront = false;
  let inDesc = false;
  let desc = '';

  for (const line of lines) {
    if (/^---[ \t]*$/u.test(line)) {
      frontDelims += 1;
      inFront = frontDelims < 2;
      continue;
    }
    if (inFront && /^description:/u.test(line)) {
      const value = line.replace(/^description:[ \t]*/u, '');
      if (/^[>|]/u.test(value) || value === '') {
        desc = '';
        inDesc = true;
      } else {
        desc = value;
        inDesc = false;
      }
      continue;
    }
    if (inFront && inDesc && /^[ \t]/u.test(line)) {
      desc = `${desc} ${line.replace(/^[ \t]+/u, '')}`;
      continue;
    }
    if (inFront && /^[A-Za-z_]+:/u.test(line)) inDesc = false;
  }

  desc = desc.replace(/^[ \t]+|[ \t]+$/gu, '').replace(/[ \t]+/gu, ' ');
  return desc.length > 160 ? `${desc.slice(0, 157)}...` : desc;
};

export const classifyType = (id: string, noteRe: RegExp = DEFAULT_NOTE_RE): SkillType =>
  noteRe.test(id) ? 'note' : 'functional';

export interface MatchOptions {
  readonly type?: SkillType;
  readonly source?: SkillSourceKind;
  readonly limit?: number;
}

const occurrences = (haystack: string, needle: string): number => {
  if (needle.length === 0) return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at === -1) return count;
    count += 1;
    from = at + needle.length;
  }
};

/** Filter the catalog by a case-insensitive query (id + description), ranked by hit count. */
export const matchSkills = (
  catalog: Catalog,
  query: string,
  options: MatchOptions = {},
): Catalog => {
  const q = query.toLowerCase();
  const scored = catalog
    .filter((ref) => options.type === undefined || ref.type === options.type)
    .filter((ref) => options.source === undefined || ref.source === options.source)
    .map((ref) => ({ ref, hits: occurrences(`${ref.id} ${ref.description}`.toLowerCase(), q) }))
    .filter((entry) => entry.hits > 0)
    .sort((a, b) => (b.hits !== a.hits ? b.hits - a.hits : a.ref.id < b.ref.id ? -1 : 1))
    .map((entry) => entry.ref);
  return options.limit !== undefined ? scored.slice(0, Math.max(0, options.limit)) : scored;
};

/** A prompt-injectable block listing the chosen skills for progressive disclosure (bash `inject`). */
export const renderInjection = (refs: readonly SkillRef[]): string => {
  const lines = ['[Skills available for this task — crawl only the ones you need]'];
  for (const ref of refs) lines.push(`- ${ref.id} (${ref.path}): ${ref.description}`);
  lines.push('Invoke a needed skill with the Skill tool, or Read its SKILL.md path above.');
  return lines.join('\n');
};
