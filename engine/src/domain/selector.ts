/**
 * Disagreement router for best-of-N fan-out orchestration. Pure decision logic,
 * no I/O.
 *
 * The empirical finding this encodes (megabench B1/B2/B3, 2026-07): fan-out of
 * cheap models only matches a premium single model when the task has a cheap,
 * reliable verifier. With a free runtime gate (unit tests / a reference
 * solution) best-of-N is "free" — the gate picks the passing candidate. Without
 * one, agreement is the only signal left, and it FAILS CORRELATED: on
 * security / impossible-requirement / subtle-correctness traps the whole fleet
 * tends to fall into the same hole together (EDV calls this the
 * self-confirmation trap), so consensus there is confidently wrong.
 *
 * v2 mechanisms, each borrowed from a specific paper:
 * - Three-way outcome (EDV, arXiv:2606.24428): unanimous-but-unverified
 *   consensus is its own outcome (`TRUST_SPOT_CHECK`), not clean `TRUST` —
 *   write-in is a high-bar action, default is reject/escalate.
 * - Forced-escalate categories (SkillHarness safe-skill boundaries + B3 data):
 *   categories whose disagreement signal is known-broken skip consensus
 *   entirely and escalate unless a real gate vouches.
 * - Laplace-smoothed confidence (OmniOPD Bayesian smoothing,
 *   arXiv-2026 OmniOPD): finite fleets (n≈5) make raw shares jumpy;
 *   (k+1)/(n+2) keeps 5/5 from reading as certainty 1.0.
 * - Escalation priority (OmniOPD peak-entropy scheduling, discrete version):
 *   spend the premium budget on the most-split tasks first.
 * - Escalation as a first-class action (Agentic Abstention,
 *   arXiv:2606.28733): escalating is the CORRECT move on unsatisfiable /
 *   unverifiable work, not a failure of the ensemble.
 *
 * Future direction (deliberately not built): a learned router à la
 * TRINITY / Conductor — tiny probe + evolved scheduling head replacing these
 * hand rules once selector-decision evidence accumulates.
 */

/** What the router decides to do with a fan-out's candidates. */
export type SelectorOutcome =
  /** A real verifier vouched for the pick — the only clean trust. */
  | 'TRUST'
  /**
   * Consensus with NO verifier behind it. Usable, but flagged: the caller
   * should spot-check a sample of these (the fleet can agree and be wrong
   * together — the self-confirmation trap).
   */
  | 'TRUST_SPOT_CHECK'
  /** Send to a premium model / human. A first-class action, not a failure. */
  | 'ESCALATE';

/** Why the router landed on its outcome. */
export type SelectorReason =
  /** A free verifier confirmed ≥1 candidate — best-of-N is free, pick a passer. */
  | 'gate-verified'
  /** A gate ran but every candidate failed — nothing to trust, escalate. */
  | 'gate-failed'
  /**
   * Task category is on the forced-escalate list and no gate vouched —
   * consensus is known-unreliable here (correlated failures), skip it.
   */
  | 'forced-category'
  /** No free gate, but a dominant answer cluster met the trust threshold. */
  | 'quorum'
  /** No free gate and no dominant cluster — the fleet split, escalate. */
  | 'split'
  /** A lone unverified candidate with no corroboration. */
  | 'singleton'
  /** Nothing to decide. */
  | 'empty';

/** One fan-out candidate the router considers. */
export interface Candidate {
  /** The agent/model that produced this candidate. */
  readonly agent: string;
  /**
   * Free-gate result, when a cheap verifier exists (unit tests, reference
   * solution, static security rules). `undefined` means no gate was available
   * for this candidate.
   */
  readonly verified?: boolean;
  /**
   * Bucket key for agreement clustering when there is no free gate — e.g. a
   * normalized answer, or a cheap judge's verdict. Candidates sharing a label
   * are treated as agreeing. `undefined` means "not clusterable".
   */
  readonly label?: string;
}

export interface SelectorConfig {
  /**
   * Minimum SMOOTHED confidence of the dominant label cluster required to
   * trust the ensemble when there is no free gate. Range (0, 1). Default 0.7:
   * with n=5 a unanimous 5/5 smooths to 6/7 ≈ 0.857 (passes) while a 4/5
   * majority smooths to 5/7 ≈ 0.714 (passes only just); 3/5 → 4/7 ≈ 0.571
   * (escalates).
   */
  readonly trustThreshold: number;
  /**
   * Whether to trust a single unverified candidate (no corroboration). Default
   * false — a lone answer with no verifier and no second opinion escalates.
   */
  readonly trustSingleton: boolean;
  /**
   * Task categories whose consensus signal is known-broken (the fleet fails
   * correlated). Without a gate these escalate outright — B3 measured the
   * collective-trap residue concentrating in security / correctness /
   * impossible-requirement tasks.
   */
  readonly forcedEscalateCategories: readonly string[];
}

export const DEFAULT_SELECTOR_CONFIG: SelectorConfig = {
  trustThreshold: 0.7,
  trustSingleton: false,
  forcedEscalateCategories: ['security', 'correctness', 'impossible'],
};

export interface SelectorDecision {
  readonly outcome: SelectorOutcome;
  /** Chosen candidate's agent when trusting; `undefined` when ESCALATE. */
  readonly pick?: string;
  readonly reason: SelectorReason;
  /**
   * Raw dominant-cluster share in [0, 1] on the agreement path; 1 when a free
   * gate decided; 0 when there was nothing to agree on.
   */
  readonly agreementShare: number;
  /**
   * Laplace-smoothed posterior confidence (k+1)/(n+2) of the dominant cluster,
   * where k = dominant size, n = labeled candidates. Damps small-fleet
   * certainty: 5/5 → 0.857, not 1.0. Equals 1 only on the gate path.
   */
  readonly confidence: number;
}

const escalate = (
  reason: SelectorReason,
  agreementShare: number,
  confidence: number,
): SelectorDecision => ({
  outcome: 'ESCALATE',
  reason,
  agreementShare,
  confidence,
});

/** Laplace-smoothed posterior for k agreeing of n labeled (add-one both ways). */
const smoothed = (k: number, n: number): number => (k + 1) / (n + 2);

/** Group labeled candidates by label, preserving first-seen agent per bucket. */
const clusterByLabel = (
  candidates: readonly Candidate[],
): Map<string, string[]> => {
  const clusters = new Map<string, string[]>();
  for (const c of candidates) {
    if (c.label === undefined) continue;
    const bucket = clusters.get(c.label);
    if (bucket) bucket.push(c.agent);
    else clusters.set(c.label, [c.agent]);
  }
  return clusters;
};

/**
 * Decide what to do with one fan-out's candidates.
 *
 * Precedence:
 *   1. Free gate — if any candidate is `verified === true`, TRUST it (the only
 *      clean trust). If a gate ran but none passed, ESCALATE.
 *   2. Forced category — no gate + `taskCategory` on the forced list →
 *      ESCALATE outright; consensus is known-unreliable there.
 *   3. Agreement — cluster by `label`; the dominant cluster's SMOOTHED
 *      confidence must reach `trustThreshold`, and even then the outcome is
 *      only TRUST_SPOT_CHECK (unverified consensus is never clean).
 */
export const route = (
  candidates: readonly Candidate[],
  config: SelectorConfig = DEFAULT_SELECTOR_CONFIG,
  taskCategory?: string,
): SelectorDecision => {
  if (candidates.length === 0) return escalate('empty', 0, 0);

  // 1. Free-gate precedence.
  const verifiedPass = candidates.find((c) => c.verified === true);
  if (verifiedPass) {
    return {
      outcome: 'TRUST',
      pick: verifiedPass.agent,
      reason: 'gate-verified',
      agreementShare: 1,
      confidence: 1,
    };
  }
  const gateRan = candidates.some((c) => c.verified !== undefined);
  if (gateRan) return escalate('gate-failed', 0, 0);

  // 2. Forced-escalate categories: consensus signal is known-broken here.
  if (
    taskCategory !== undefined &&
    config.forcedEscalateCategories.includes(taskCategory)
  ) {
    return escalate('forced-category', 0, 0);
  }

  // 3. Agreement path (no free verifier) — best case is TRUST_SPOT_CHECK.
  const clusters = clusterByLabel(candidates);
  const labeledTotal = [...clusters.values()].reduce(
    (n, bucket) => n + bucket.length,
    0,
  );
  if (labeledTotal === 0) return escalate('split', 0, 0);

  let dominant: { agent: string; size: number } | undefined;
  for (const bucket of clusters.values()) {
    const agent = bucket[0];
    if (agent === undefined) continue;
    if (!dominant || bucket.length > dominant.size)
      dominant = { agent, size: bucket.length };
  }
  if (!dominant) return escalate('split', 0, 0);

  const share = dominant.size / labeledTotal;
  const confidence = smoothed(dominant.size, labeledTotal);

  if (labeledTotal === 1) {
    return config.trustSingleton
      ? {
          outcome: 'TRUST_SPOT_CHECK',
          pick: dominant.agent,
          reason: 'quorum',
          agreementShare: 1,
          confidence,
        }
      : escalate('singleton', 1, confidence);
  }

  return confidence >= config.trustThreshold
    ? {
        outcome: 'TRUST_SPOT_CHECK',
        pick: dominant.agent,
        reason: 'quorum',
        agreementShare: share,
        confidence,
      }
    : escalate('split', share, confidence);
};

/**
 * Order escalated decisions by where the premium budget helps most — the
 * discrete analogue of OmniOPD's peak-entropy scheduler: the teacher's
 * attention goes to the forks the fleet is least certain about. Most-split
 * first (lowest confidence), gate-failures and forced categories ahead of mere
 * splits at equal confidence.
 *
 * Returns indices into `decisions`, escalated ones only, in spend order.
 */
export const escalationPriority = (
  decisions: readonly SelectorDecision[],
): readonly number[] => {
  const reasonRank: Record<SelectorReason, number> = {
    'gate-failed': 0,
    'forced-category': 1,
    split: 2,
    singleton: 3,
    empty: 4,
    quorum: 5,
    'gate-verified': 6,
  };
  return decisions
    .map((d, i) => ({ d, i }))
    .filter(({ d }) => d.outcome === 'ESCALATE')
    .sort(
      (a, b) =>
        a.d.confidence - b.d.confidence ||
        reasonRank[a.d.reason] - reasonRank[b.d.reason] ||
        a.i - b.i,
    )
    .map(({ i }) => i);
};
