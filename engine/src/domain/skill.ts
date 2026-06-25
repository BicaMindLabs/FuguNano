/**
 * Skills mother-catalog (progressive disclosure): index every local SKILL.md
 * into a compact catalog, so a weak agent is handed only the few skills it needs
 * — not all several-hundred.
 */
export type SkillType = 'functional' | 'note';
export type SkillSourceKind = 'user' | 'system' | 'plugin';

export interface SkillRef {
  readonly id: string;
  readonly source: SkillSourceKind;
  readonly type: SkillType;
  readonly path: string; // path to the SKILL.md
  readonly description: string;
}
export type Catalog = readonly SkillRef[];

export interface SkillSource {
  readonly kind: SkillSourceKind;
  /** Directory whose immediate subdirs each may hold a `SKILL.md`. */
  readonly dir: string;
  /** If set, ids become `<idPrefix>:<skill-dir>` (e.g. plugin skills). */
  readonly idPrefix?: string;
}

/** Note-prefix regex (bash FUGUE_SKILLS_NOTE_RE default): these ids are learning notes, not functional skills. */
export const DEFAULT_NOTE_RE = /^(wdkns|book|csdiy|dlai|mit|mooc|child|tu-online)/u;
