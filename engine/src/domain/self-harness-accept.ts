import type {
  EditableSurface,
  FailureSignature,
  HarnessConfig,
  HarnessEdit,
  SplitScores,
  TaggedFailure,
  ValidationVerdict,
  WeaknessCluster,
} from './self-harness.js';

/** UTF-16 code-unit order — the engine's deterministic tie-break (matches allocation sort). */
const byCodepoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Stable signature key for grouping (JSON-encoded tuple — unambiguous field boundaries). */
const signatureKey = (sig: FailureSignature): string =>
  JSON.stringify([sig.cause, sig.causalStatus, sig.mechanism]);

/**
 * The acceptance gate (the paper's soul): promote a candidate iff it improves at
 * least one split without regressing the other —
 *   delta_in >= 0 AND delta_out >= 0 AND max(delta_in, delta_out) > 0.
 * Splits are fixed-size across variants, so pass-count deltas are sound.
 */
export const acceptEdit = (current: SplitScores, candidate: SplitScores): ValidationVerdict => {
  if (current.inTotal !== candidate.inTotal || current.outTotal !== candidate.outTotal) {
    // Programmer error: the two harnesses must be scored on the identical fixed splits,
    // otherwise pass-count deltas are meaningless.
    throw new Error('acceptEdit: split totals must match between current and candidate');
  }
  const deltaIn = candidate.inPass - current.inPass;
  const deltaOut = candidate.outPass - current.outPass;
  const accepted = deltaIn >= 0 && deltaOut >= 0 && Math.max(deltaIn, deltaOut) > 0;
  return { deltaIn, deltaOut, accepted };
};

/** Apply one edit to a config — replaces only the target surface (immutable). */
export const applyEdit = (config: HarnessConfig, edit: HarnessEdit): HarnessConfig => ({
  ...config,
  [edit.surface]: edit.after,
});

/**
 * Cluster tagged failures by exact signature.
 * Deterministic order: descending count, then mechanism by code point.
 */
export const clusterWeaknesses = (
  failures: readonly TaggedFailure[],
): readonly WeaknessCluster[] => {
  const groups = new Map<string, { signature: FailureSignature; taskKeys: string[] }>();
  for (const failure of failures) {
    const key = signatureKey(failure.signature);
    const existing = groups.get(key);
    if (existing) existing.taskKeys.push(failure.taskKey);
    else groups.set(key, { signature: failure.signature, taskKeys: [failure.taskKey] });
  }
  return [...groups.values()]
    .map((group) => ({
      signature: group.signature,
      count: group.taskKeys.length,
      taskKeys: group.taskKeys,
    }))
    .sort((a, b) => b.count - a.count || byCodepoint(a.signature.mechanism, b.signature.mechanism));
};

/**
 * Merge a round's accepted edits into the config. Compatible edits target
 * distinct surfaces; if two accepted edits hit the same surface, the first wins
 * (callers pass higher-impact edits first), so a round stays a single coherent step.
 */
export const mergeAccepted = (
  config: HarnessConfig,
  edits: readonly HarnessEdit[],
): HarnessConfig => {
  const taken = new Set<EditableSurface>();
  let next = config;
  for (const edit of edits) {
    if (taken.has(edit.surface)) continue;
    taken.add(edit.surface);
    next = applyEdit(next, edit);
  }
  return next;
};

/** Total improvement of a verdict (delta_in + delta_out) — used to order accepted edits by impact. */
export const totalDelta = (verdict: ValidationVerdict): number =>
  verdict.deltaIn + verdict.deltaOut;
