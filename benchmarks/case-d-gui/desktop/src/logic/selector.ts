// Selector types + a routePreview() mirror — vendored from engine/src/domain/selector.ts so the
// GUI needs no cross-package import of the built engine (the engine ships as dist; importing it
// here would couple the renderer build to an engine build step).
//
// DRIFT WARNING: routePreview() below MUST stay behaviourally identical to the engine's route().
// selector.test.ts pins the mirror with golden cases covering all three outcomes and seven reasons,
// so an accidental edit here fails CI — but the guard is one-directional: if engine
// src/domain/selector.ts::route changes (precedence gate → forced-category → smoothed consensus,
// the (k+1)/(n+2) smoothing, or the trustThreshold/trustSingleton defaults), you must hand-mirror
// the change here AND update selector.test.ts. The Selector view is the user-facing claim that
// these match; if they diverge the GUI confidently shows the wrong routing verdict.

export type SelectorOutcome = 'TRUST' | 'TRUST_SPOT_CHECK' | 'ESCALATE';

export type SelectorReason =
  | 'gate-verified'
  | 'gate-failed'
  | 'forced-category'
  | 'quorum'
  | 'split'
  | 'singleton'
  | 'empty';

export interface Candidate {
  readonly agent: string;
  readonly verified?: boolean;
  readonly label?: string;
}

export interface SelectorDecision {
  readonly outcome: SelectorOutcome;
  readonly pick?: string;
  readonly reason: SelectorReason;
  readonly agreementShare: number;
  readonly confidence: number;
}

// Map the three outcomes onto the Geist role colors already in geist.css.
export const outcomeColor = (o: SelectorOutcome): string =>
  o === 'TRUST' ? 'var(--green-700)' : o === 'TRUST_SPOT_CHECK' ? 'var(--amber-700)' : 'var(--red-800)';

export const outcomeExit = (o: SelectorOutcome): number =>
  o === 'TRUST' ? 0 : o === 'TRUST_SPOT_CHECK' ? 10 : 20;

// One-line plain-English gloss of why the router landed where it did.
export const reasonLabel = (r: SelectorReason): string => {
  switch (r) {
    case 'gate-verified':
      return 'A verifier vouched for a candidate — the only clean trust.';
    case 'gate-failed':
      return 'A gate ran but every candidate failed — nothing to trust.';
    case 'forced-category':
      return 'High-risk category — consensus is known-unreliable here, so escalate.';
    case 'quorum':
      return 'No gate, but a dominant answer cluster passed the trust threshold.';
    case 'split':
      return 'No gate and no dominant cluster — the fleet split.';
    case 'singleton':
      return 'A lone unverified candidate with no corroboration.';
    case 'empty':
      return 'Nothing to decide.';
  }
};

// Client-side mirror of engine route() so the Selector view can preview hand-built candidates
// without spawning fuguectl. Same precedence: gate → forced category → smoothed consensus.
export interface RouteConfig {
  readonly trustThreshold: number;
  readonly trustSingleton: boolean;
  readonly forcedEscalateCategories: readonly string[];
}

export const DEFAULT_ROUTE_CONFIG: RouteConfig = {
  trustThreshold: 0.7,
  trustSingleton: false,
  forcedEscalateCategories: ['security', 'correctness', 'impossible'],
};

const smoothed = (k: number, n: number): number => (k + 1) / (n + 2);

export const routePreview = (
  candidates: readonly Candidate[],
  config: RouteConfig = DEFAULT_ROUTE_CONFIG,
  category?: string,
): SelectorDecision => {
  const esc = (reason: SelectorReason, share: number, confidence: number): SelectorDecision => ({
    outcome: 'ESCALATE',
    reason,
    agreementShare: share,
    confidence,
  });
  if (candidates.length === 0) return esc('empty', 0, 0);

  const pass = candidates.find((c) => c.verified === true);
  if (pass)
    return { outcome: 'TRUST', pick: pass.agent, reason: 'gate-verified', agreementShare: 1, confidence: 1 };
  if (candidates.some((c) => c.verified !== undefined)) return esc('gate-failed', 0, 0);

  if (category !== undefined && config.forcedEscalateCategories.includes(category))
    return esc('forced-category', 0, 0);

  const clusters = new Map<string, string[]>();
  for (const c of candidates) {
    if (c.label === undefined) continue;
    const bucket = clusters.get(c.label);
    if (bucket) bucket.push(c.agent);
    else clusters.set(c.label, [c.agent]);
  }
  const labeled = [...clusters.values()].reduce((n, b) => n + b.length, 0);
  if (labeled === 0) return esc('split', 0, 0);

  let dominant: { agent: string; size: number } | undefined;
  for (const bucket of clusters.values()) {
    const agent = bucket[0];
    if (agent === undefined) continue;
    if (!dominant || bucket.length > dominant.size) dominant = { agent, size: bucket.length };
  }
  if (!dominant) return esc('split', 0, 0);

  const share = dominant.size / labeled;
  const confidence = smoothed(dominant.size, labeled);
  if (labeled === 1) {
    return config.trustSingleton
      ? { outcome: 'TRUST_SPOT_CHECK', pick: dominant.agent, reason: 'quorum', agreementShare: 1, confidence }
      : esc('singleton', 1, confidence);
  }
  return confidence >= config.trustThreshold
    ? { outcome: 'TRUST_SPOT_CHECK', pick: dominant.agent, reason: 'quorum', agreementShare: share, confidence }
    : esc('split', share, confidence);
};
