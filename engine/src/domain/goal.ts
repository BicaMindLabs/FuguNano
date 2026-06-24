/**
 * Goal mode: a declarative target + a deterministic acceptance gate (bash `goal`).
 * The gate is a shell command; the goal is "met" iff it exits 0.
 */
export interface GoalSpec {
  readonly outcome: string;
  /** A runnable objective acceptance command (e.g. `pytest -q && npm run build`). */
  readonly gate: string;
  /** Focus areas for the reviewer's subjective pass. */
  readonly rubric: string;
  /** Loop round cap. */
  readonly rounds: number;
  readonly allocate: 'auto' | 'manual';
}
