import type { HarnessConfig, HarnessEdit, SplitScores, WeaknessCluster } from '../self-harness.js';

/**
 * Stage 1 — Weakness Mining. Surface verifier-grounded weakness clusters from a
 * completed run (reads its failures + verdicts, tags each with a signature, and
 * clusters them). The pure clustering lives in `clusterWeaknesses`; an adapter
 * supplies the run-specific failures and signature tagging.
 */
export interface WeaknessMiner {
  mine(runId: string): Promise<readonly WeaknessCluster[]>;
}

/**
 * Stage 2 — Harness Proposal. Produce up to `k` diverse, bounded, single-surface
 * edits, each anchored to one weakness mechanism. Implementations are typically
 * model-backed; the contract is that every edit names the surface it changes and
 * the mechanism it addresses.
 */
export interface HarnessProposer {
  propose(
    config: HarnessConfig,
    clusters: readonly WeaknessCluster[],
    k: number,
  ): Promise<readonly HarnessEdit[]>;
}

/**
 * Stage 3 — Proposal Validation. Evaluate a harness configuration on the two
 * fixed splits (held-in + held-out) and return its pass scores. The loop scores
 * the current config and each candidate, then applies the acceptance gate.
 */
export interface HarnessValidator {
  score(config: HarnessConfig): Promise<SplitScores>;
}
