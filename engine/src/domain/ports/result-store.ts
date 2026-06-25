import type { Artifact } from '../artifact.js';

/**
 * Durable storage of per-key task outputs (the join result cache). An adapter
 * may be in-memory (tests) or filesystem-backed (parity with the bash cache).
 */
export interface ResultStore {
  put(key: string, artifacts: readonly Artifact[]): Promise<void>;
  get(key: string): Promise<readonly Artifact[] | null>;
  keys(): Promise<readonly string[]>;
}
