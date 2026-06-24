import { acceptEdit, applyEdit, mergeAccepted, totalDelta } from '../domain/self-harness-accept.js';
import type {
  EditableSurface,
  HarnessConfig,
  HarnessEdit,
  LineageEntry,
  ValidationVerdict,
} from '../domain/self-harness.js';
import type {
  HarnessProposer,
  HarnessValidator,
  WeaknessMiner,
} from '../domain/ports/self-harness.js';

export interface SelfHarnessDeps {
  readonly miner: WeaknessMiner;
  readonly proposer: HarnessProposer;
  readonly validator: HarnessValidator;
  /** Number of candidate edits to request per round. */
  readonly k: number;
}

/** Outcome of one propose -> validate -> accept round. */
export interface RoundResult {
  readonly round: number;
  /** The config after this round (unchanged if nothing was accepted). */
  readonly config: HarnessConfig;
  /** Edits promoted this round, highest-impact first. */
  readonly accepted: readonly HarnessEdit[];
  /** Per-candidate audit trail (accepted and rejected). */
  readonly lineage: readonly LineageEntry[];
}

/**
 * "Our own thing": the engine analogue of Self-Harness Algorithm 1. Composes the
 * three ports (mine -> propose -> validate) around the pure acceptance gate, with
 * the model, evaluator, and benchmark held fixed — only the harness config evolves.
 * Every transition (accept or reject) is recorded for an auditable lineage.
 */
export class SelfHarnessLoop {
  constructor(private readonly deps: SelfHarnessDeps) {}

  /** Run a single round: mine weaknesses, propose edits, validate each, promote the survivors. */
  async runRound(round: number, runId: string, config: HarnessConfig): Promise<RoundResult> {
    const clusters = await this.deps.miner.mine(runId);
    if (clusters.length === 0) {
      return { round, config, accepted: [], lineage: [] };
    }

    const proposals = await this.deps.proposer.propose(config, clusters, this.deps.k);
    const current = await this.deps.validator.score(config);

    // Evaluate every candidate independently under the same fixed splits. Each carries
    // its position so promotion is tracked by index, not object identity (a proposer that
    // returns the same edit object twice must not double-count in the lineage).
    const evaluations: { index: number; edit: HarnessEdit; verdict: ValidationVerdict }[] = [];
    for (const edit of proposals) {
      const candidate = await this.deps.validator.score(applyEdit(config, edit));
      evaluations.push({
        index: evaluations.length,
        edit,
        verdict: acceptEdit(current, candidate),
      });
    }

    // Promote gate-passing edits, highest-impact first, at most one per surface — so a
    // round is one coherent step; same-surface losers are shadowed (not promoted).
    const promoted: HarnessEdit[] = [];
    const promotedIndices = new Set<number>();
    const takenSurfaces = new Set<EditableSurface>();
    for (const evaluation of evaluations
      .filter((e) => e.verdict.accepted)
      .sort((a, b) => totalDelta(b.verdict) - totalDelta(a.verdict))) {
      if (takenSurfaces.has(evaluation.edit.surface)) continue;
      takenSurfaces.add(evaluation.edit.surface);
      promoted.push(evaluation.edit);
      promotedIndices.add(evaluation.index);
    }

    // Lineage records every candidate; `decision` = was it actually promoted. A
    // gate-passing-but-shadowed candidate reads decision 'rejected' with verdict.accepted true.
    const lineage: LineageEntry[] = evaluations.map((e) => ({
      round,
      surface: e.edit.surface,
      mechanism: e.edit.mechanism,
      verdict: e.verdict,
      decision: promotedIndices.has(e.index) ? 'accepted' : 'rejected',
    }));

    return { round, config: mergeAccepted(config, promoted), accepted: promoted, lineage };
  }

  /**
   * Run several rounds, threading the evolving config. `runIdFor` supplies each
   * round's source run (a fresh harness execution feeds fresh weakness mining).
   */
  async run(
    rounds: number,
    config: HarnessConfig,
    runIdFor: (round: number) => string,
  ): Promise<{ config: HarnessConfig; lineage: readonly LineageEntry[] }> {
    let current = config;
    const lineage: LineageEntry[] = [];
    for (let round = 1; round <= rounds; round += 1) {
      const result = await this.runRound(round, runIdFor(round), current);
      current = result.config;
      lineage.push(...result.lineage);
    }
    return { config: current, lineage };
  }
}
