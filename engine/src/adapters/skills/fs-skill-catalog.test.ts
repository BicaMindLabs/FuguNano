import { describe, expect, it } from 'vitest';

import { MemoryFileSystem } from '../../infra/memory-file-system.js';
import { systemClock } from '../../infra/clock.js';
import type { SkillSource } from '../../domain/skill.js';
import { FsSkillCatalog } from './fs-skill-catalog.js';

const skillMd = (desc: string): string => `---\nname: x\ndescription: ${desc}\n---\nbody`;

const seed = async (): Promise<FsSkillCatalog> => {
  const fs = new MemoryFileSystem(systemClock);
  await fs.write('/user/fanout/SKILL.md', skillMd('fan out work'));
  await fs.write('/user/book-x/SKILL.md', skillMd('a book note'));
  await fs.write('/user/notes.txt', 'ignore'); // no SKILL.md → skipped
  await fs.write('/plug/imagegen/SKILL.md', skillMd('make images'));
  const sources: readonly SkillSource[] = [
    { kind: 'user', dir: '/user' },
    { kind: 'plugin', dir: '/plug', idPrefix: 'official' },
  ];
  return new FsSkillCatalog(fs, sources);
};

describe('FsSkillCatalog', () => {
  it('indexes SKILL.md across sources, prefixes plugin ids, classifies type', async () => {
    const catalog = await (await seed()).index();
    expect(catalog.map((r) => `${r.id}:${r.source}:${r.type}`)).toEqual([
      'book-x:user:note', // sorted by id
      'fanout:user:functional',
      'official:imagegen:plugin:functional',
    ]);
    expect(catalog.find((r) => r.id === 'fanout')?.description).toBe('fan out work');
  });

  it('matches a query across the catalog', async () => {
    const hits = await (await seed()).match('book');
    expect(hits.map((r) => r.id)).toEqual(['book-x']);
  });

  it('injects a context block for selected ids', async () => {
    const block = await (await seed()).inject(['fanout', 'official:imagegen']);
    expect(block).toContain('- fanout (/user/fanout/SKILL.md): fan out work');
    expect(block).toContain('- official:imagegen (/plug/imagegen/SKILL.md): make images');
  });
});
