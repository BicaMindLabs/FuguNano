import type { Catalog } from '../skill.js';
import type { MatchOptions } from '../skill-parse.js';

/**
 * The skills mother-catalog: index every source's SKILL.md into one catalog,
 * search it, and emit an injection block for the chosen skills.
 */
export interface SkillCatalog {
  /** Build (and cache) the catalog from all sources. */
  index(): Promise<Catalog>;
  /** Query the catalog, ranked by hit count. */
  match(query: string, options?: MatchOptions): Promise<Catalog>;
  /** A prompt-injectable context block for the chosen skill ids (progressive disclosure). */
  inject(ids: readonly string[]): Promise<string>;
}
