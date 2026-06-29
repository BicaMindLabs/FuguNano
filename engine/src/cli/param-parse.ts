/**
 * Shared CLI argument-parsing primitives. These were copied verbatim across
 * several command handlers (splitCsv lived in four); keep one source so the
 * parsing contract can't drift between commands. Intentionally tiny and
 * presentation-free — enum/membership validation belongs in the domain
 * (e.g. isExperienceSourceKind), not here.
 */

/** Split a comma-separated option value, trimming parts and dropping empties. */
export const splitCsv = (raw: string): readonly string[] =>
  raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

/** Trim + lowercase an optional flag value; `undefined` passes through. */
export const normalizeOption = (raw: string | undefined): string | undefined =>
  raw?.trim().toLowerCase();
