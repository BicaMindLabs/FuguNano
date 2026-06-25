import type { GateResult } from '../gate.js';

/**
 * An environment/run check that yields GO/NO-GO findings. IO-bound gates
 * (dependency presence, provider mount, endpoint liveness) implement this; purely
 * deterministic gates (config soundness, policy evaluation) are plain functions
 * in the domain that return a `GateResult` directly.
 */
export interface QualityGate {
  readonly name: string;
  check(): Promise<GateResult>;
}
