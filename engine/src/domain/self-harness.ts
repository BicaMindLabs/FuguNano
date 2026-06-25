/**
 * Self-Harness — value objects for the engine's self-improving-harness loop.
 *
 * Our abstraction of Shanghai AI Lab's Self-Harness paper (arXiv 2606.09498):
 * with the model, evaluator, and benchmark held fixed, only the *harness
 * configuration* evolves.
 * Each round mines verifier-grounded weaknesses, proposes bounded edits to the
 * declared editable surfaces, and promotes an edit only if it improves one
 * evaluation split without regressing the other. These types are pure; the
 * mining / proposing / scoring IO lives behind ports (see ports/self-harness.ts).
 */

/** The configurable surfaces of a harness — our analogue of the paper's `build_*` editable interface. */
export type EditableSurface =
  | 'system-prompt'
  | 'memory-sources'
  | 'subagents'
  | 'skills'
  | 'bootstrap'
  | 'execution'
  | 'verification'
  | 'failure-recovery'
  | 'runtime-policy';

export const EDITABLE_SURFACES: readonly EditableSurface[] = [
  'system-prompt',
  'memory-sources',
  'subagents',
  'skills',
  'bootstrap',
  'execution',
  'verification',
  'failure-recovery',
  'runtime-policy',
];

/** The evolving harness state: every editable surface maps to its current text. */
export type HarnessConfig = Readonly<Record<EditableSurface, string>>;

/**
 * A verifier-grounded failure signature φ = (cause, causal status, mechanism).
 * `mechanism` is the harness-addressable lever an edit can pull to fix it.
 */
export interface FailureSignature {
  readonly cause: string;
  readonly causalStatus: string;
  readonly mechanism: string;
}

/** A single observed task failure tagged with its signature. */
export interface TaggedFailure {
  readonly taskKey: string;
  readonly signature: FailureSignature;
}

/** A cluster of failures sharing a signature — one mineable weakness. */
export interface WeaknessCluster {
  readonly signature: FailureSignature;
  readonly count: number;
  readonly taskKeys: readonly string[];
}

/** A bounded, single-surface proposed edit, anchored to a weakness mechanism. */
export interface HarnessEdit {
  readonly surface: EditableSurface;
  /** The mechanism (cluster signature) this edit is meant to address. */
  readonly mechanism: string;
  /** The replacement content for the target surface. */
  readonly after: string;
  readonly rationale: string;
}

/** Pass results on the two fixed evaluation splits (counts + sizes). */
export interface SplitScores {
  readonly inPass: number;
  readonly inTotal: number;
  readonly outPass: number;
  readonly outTotal: number;
}

/** The non-regression verdict for a candidate harness vs the current one. */
export interface ValidationVerdict {
  /** Δin = candidate held-in passes − current held-in passes. */
  readonly deltaIn: number;
  /** Δho = candidate held-out passes − current held-out passes. */
  readonly deltaOut: number;
  readonly accepted: boolean;
}

/** One audited transition in the harness lineage. */
export interface LineageEntry {
  readonly round: number;
  readonly surface: EditableSurface;
  readonly mechanism: string;
  readonly verdict: ValidationVerdict;
  readonly decision: 'accepted' | 'rejected';
}
