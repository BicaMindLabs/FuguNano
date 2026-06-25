import type { Result } from '../result.js';
import type { DispatchError, DispatchRequest, DispatchResult, HealthStatus } from '../dispatch.js';

export const HARNESS_NAMES = ['fugue-cc', 'codex', 'opencode'] as const;
export type HarnessName = (typeof HARNESS_NAMES)[number];

/**
 * One job model over a fleet of executors. Adapters wrap the corresponding
 * blocking CLI (`fugue-cc` / `codex exec` / `opencode run`); a future remote
 * harness may poll internally and still resolve a single Promise.
 */
export interface Harness {
  readonly name: HarnessName;
  /** Run the prompt on the target agent; resolve with the output or a typed error. */
  dispatch(request: DispatchRequest): Promise<Result<DispatchResult, DispatchError>>;
  /** Whether this harness is ready to accept dispatches (for fugue-cc, provider mounted). */
  health(): Promise<HealthStatus>;
}
