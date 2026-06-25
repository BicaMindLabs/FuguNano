/**
 * Dispatching work to an agent over a harness (fugue-cc / codex / opencode).
 *
 * Dispatch is modeled as one async call returning a `Result` — every harness we
 * target is a blocking CLI (`fugue-cc` via provider, `codex exec`,
 * `opencode run`), so the Promise resolves when the agent is done. Parallel dispatch
 * parallelism and resume live in the Barrier/ResultStore layer, not here (see
 * docs/ARCHITECTURE.md §5).
 */

export interface DispatchRequest {
  /** Target: a fugue-cc agent (cc-deepseek), a codex model, or an opencode provider/model. */
  readonly agent: string;
  /** The fully-rendered prompt fed to the agent. */
  readonly prompt: string;
  /** Optional workspace/context label (for logging + future scoping). */
  readonly workspace?: string;
  /** Optional task type (feeds the allocation flywheel downstream). */
  readonly taskType?: string;
}

export interface DispatchResult {
  readonly agent: string;
  readonly output: string;
  readonly exitCode: number;
}

export type DispatchErrorKind = 'spawn-failed' | 'nonzero-exit' | 'unavailable';

export interface DispatchError {
  readonly agent: string;
  readonly kind: DispatchErrorKind;
  readonly detail: string;
  readonly exitCode?: number;
}

export interface HealthStatus {
  readonly healthy: boolean;
  readonly detail: string;
}
