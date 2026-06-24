import type { SkillCatalog } from '../../domain/ports/skill-catalog.js';
import type { Catalog, SkillRef, SkillSource } from '../../domain/skill.js';
import { DEFAULT_NOTE_RE } from '../../domain/skill.js';
import {
  classifyType,
  matchSkills,
  parseDescription,
  renderInjection,
  type MatchOptions,
} from '../../domain/skill-parse.js';
import type { FileSystem } from '../../infra/file-system.js';
import { joinPath } from '../store/paths.js';

/** Scans each source's `<dir>/<skill>/SKILL.md` into a catalog (cached after first index). */
export class FsSkillCatalog implements SkillCatalog {
  private cache: Catalog | null = null;

  constructor(
    private readonly fs: FileSystem,
    private readonly sources: readonly SkillSource[],
    private readonly noteRe: RegExp = DEFAULT_NOTE_RE,
  ) {}

  async index(): Promise<Catalog> {
    const refs: SkillRef[] = [];
    for (const source of this.sources) {
      const subdirs = await this.fs.list(source.dir);
      for (const sub of subdirs) {
        const path = joinPath(joinPath(source.dir, sub), 'SKILL.md');
        const content = await this.fs.read(path);
        if (content === null) continue;
        const id = source.idPrefix !== undefined ? `${source.idPrefix}:${sub}` : sub;
        refs.push({
          id,
          source: source.kind,
          type: classifyType(id, this.noteRe),
          path,
          description: parseDescription(content),
        });
      }
    }
    refs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    this.cache = refs;
    return refs;
  }

  async match(query: string, options?: MatchOptions): Promise<Catalog> {
    return matchSkills(await this.catalog(), query, options ?? {});
  }

  async inject(ids: readonly string[]): Promise<string> {
    const byId = new Map((await this.catalog()).map((ref) => [ref.id, ref]));
    const refs = ids.map((id) => byId.get(id)).filter((ref): ref is SkillRef => ref !== undefined);
    return renderInjection(refs);
  }

  private async catalog(): Promise<Catalog> {
    return this.cache ?? this.index();
  }
}
