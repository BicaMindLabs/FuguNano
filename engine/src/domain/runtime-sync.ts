/** Runtime provider version-drift detection (`fuguectl runtime`). */
export interface VersionDrift {
  readonly current: string;
  readonly last: string | null;
  readonly drifted: boolean;
}

/** Drifted iff we have a recorded last version and it differs from current. */
export const detectDrift = (current: string, last: string | null): VersionDrift => ({
  current,
  last,
  drifted: last !== null && last !== current,
});
