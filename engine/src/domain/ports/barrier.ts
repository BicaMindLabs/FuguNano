import type { TaskState } from '../task.js';
import type { RoundManifest } from '../round.js';

/**
 * The join barrier: dispatch N ⇒ N terminal. Durable + resumable (state
 * survives a process restart), and explicit about *how* each key ended
 * (`done | fail | timeout | canceled`) rather than just "all back".
 *
 * The barrier holds no clock. `settle` is an unconditional state transition
 * (expire still-pending keys to `timeout`); deciding *when* to settle — e.g.
 * once past a deadline — is the caller's job (see `app/wait-for-round.ts`). That
 * way a single clock governs timing and the two can never disagree.
 */
export interface Barrier {
  /**
   * Begin a round with its expected keys (all initially pending). Idempotent if
   * re-opened with the same expected set; throws if the set differs (so a round
   * never silently drops a dispatched key).
   */
  open(round: number, expected: readonly string[]): Promise<void>;
  /** Record a terminal (or corrected) state for one key. */
  mark(round: number, key: string, state: TaskState): Promise<void>;
  /** Current ledger, or null if the round was never opened. */
  inspect(round: number): Promise<RoundManifest | null>;
  /** Expire every still-pending expected key to `timeout`. Idempotent. */
  settle(round: number): Promise<RoundManifest>;
}
