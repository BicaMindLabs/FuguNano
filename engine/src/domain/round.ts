import type { TaskState } from './task.js';
import { isTerminal } from './task.js';

/** Epoch-millis instant by which a round must settle (from an injected `Clock`). */
export type Deadline = number;

/**
 * The join ledger for one dispatch round: every expected key and its current
 * state. The barrier is satisfied when every expected key is terminal. `states`
 * holds terminal *and* pending entries; absent keys are implicitly `pending`.
 */
export interface RoundManifest {
  readonly round: number;
  readonly expected: readonly string[];
  readonly states: Readonly<Record<string, TaskState>>;
}

/** Current state of one key (absent ⇒ `pending`). */
export const stateOf = (m: RoundManifest, key: string): TaskState => m.states[key] ?? 'pending';

/** A round is complete iff every expected key is terminal. */
export const isComplete = (m: RoundManifest): boolean =>
  m.expected.every((k) => isTerminal(stateOf(m, k)));

/** Expected keys not yet terminal. */
export const pendingKeys = (m: RoundManifest): readonly string[] =>
  m.expected.filter((k) => !isTerminal(stateOf(m, k)));

/** Count of expected keys in each state (for summaries / observability). */
export const tally = (m: RoundManifest): Readonly<Record<TaskState, number>> => {
  const counts: Record<TaskState, number> = {
    pending: 0,
    done: 0,
    fail: 0,
    timeout: 0,
    canceled: 0,
  };
  for (const k of m.expected) counts[stateOf(m, k)] += 1;
  return counts;
};
