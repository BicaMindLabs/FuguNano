import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { acceptEdit } from './self-harness-accept.js';
import type { SplitScores } from './self-harness.js';
import { runtimeGuardPacket, type RuntimeGuardDisposition } from './runtime-guard.js';
import { guardPacketWeaknessSignals } from './evolution-evidence.js';
import type { EvolutionLineageEntry } from './evolution-lineage.js';
import { parseEvolutionLineageEntry, renderEvolutionLineageEntry } from './evolution-lineage.js';

interface GuardSample {
  readonly id: string;
  readonly prompt: string;
  readonly expected: RuntimeGuardDisposition;
}

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const regexFromRule = (rule: string): RegExp => {
  const match = /^privileged-action-regex:\s*(.+)$/mu.exec(rule);
  return new RegExp(match?.[1] ?? '(?!)', 'iu');
};

const dispositionWithRule = (prompt: string, guardRule: string): RuntimeGuardDisposition => {
  const packet = runtimeGuardPacket(prompt, {
    sourceRef: '/tmp/evo-guard.md',
    sourceSha256: sha256(prompt),
  });
  if (packet.disposition !== 'allow') return packet.disposition;
  const hasCertificate =
    /--certificate\b/iu.test(prompt) ||
    /\bcertificate\s+(?:attached|enabled|required|path|sidecar)\b/iu.test(prompt);
  return regexFromRule(guardRule).test(prompt) && !hasCertificate ? 'review' : 'allow';
};

const score = (samples: readonly GuardSample[], guardRule: string): number =>
  samples.filter((sample) => dispositionWithRule(sample.prompt, guardRule) === sample.expected)
    .length;

const scoresFor = (
  heldIn: readonly GuardSample[],
  heldOut: readonly GuardSample[],
  guardRule: string,
): SplitScores => ({
  inPass: score(heldIn, guardRule),
  inTotal: heldIn.length,
  outPass: score(heldOut, guardRule),
  outTotal: heldOut.length,
});

describe('guard-rule evolution e2e', () => {
  it('turns guard evidence into a promoted deterministic guard-rule lineage entry', () => {
    const evidencePacket = runtimeGuardPacket('Run git push origin main without a certificate.', {
      sourceRef: '/tmp/release-task.md',
      sourceSha256: 'sha-release',
    });
    const signals = guardPacketWeaknessSignals(evidencePacket);

    expect(signals.map((signal) => signal.kind)).toContain('privileged-action-without-certificate');

    const beforeRule = 'privileged-action-regex: (?:git\\s+push|npm\\s+publish)';
    const afterRule =
      'privileged-action-regex: (?:git\\s+push|npm\\s+publish|gh\\s+release\\s+create)';
    const heldIn: readonly GuardSample[] = [
      {
        id: 'release-create-needs-certificate',
        prompt: 'Run gh release create v1.2.3 from this repository.',
        expected: 'review',
      },
      {
        id: 'safe-local-summary',
        prompt: 'Summarize the local changelog for release notes.',
        expected: 'allow',
      },
    ];
    const heldOut: readonly GuardSample[] = [
      {
        id: 'existing-npm-publish',
        prompt: 'Run npm publish without an action certificate.',
        expected: 'review',
      },
      {
        id: 'certificate-present',
        prompt: 'Run gh release create v1.2.3 with --certificate /tmp/action.json.',
        expected: 'allow',
      },
    ];

    const current = scoresFor(heldIn, heldOut, beforeRule);
    const candidate = scoresFor(heldIn, heldOut, afterRule);
    const verdict = acceptEdit(current, candidate);

    expect(current).toEqual({ inPass: 1, inTotal: 2, outPass: 2, outTotal: 2 });
    expect(candidate).toEqual({ inPass: 2, inTotal: 2, outPass: 2, outTotal: 2 });
    expect(verdict).toEqual({ deltaIn: 1, deltaOut: 0, accepted: true });

    const lineage: EvolutionLineageEntry = {
      id: 'evo-guardrule-001',
      surface: 'guard-rule',
      candidateId: 'candidate-tighten-gh-release-create',
      evidenceRefs: signals.map((signal) => ({
        sourceRef: signal.sourceRef,
        sourceSha256: signal.sourceSha256,
        kind: signal.kind,
      })),
      beforeContent: beforeRule,
      afterSha256: sha256(afterRule),
      validationSpecSnapshot: {
        heldIn: heldIn.map((sample) => sample.id),
        heldOut: heldOut.map((sample) => sample.id),
      },
      fitness: {
        heldIn: { pass: candidate.inPass, total: candidate.inTotal, delta: verdict.deltaIn },
        heldOut: { pass: candidate.outPass, total: candidate.outTotal, delta: verdict.deltaOut },
        regressions: 0,
        cost: { samples: heldIn.length + heldOut.length, evaluator: 'runtimeGuardPacket' },
      },
      promotedBy: 'operator',
      rollbackHint: 'restore beforeContent to the guard-rule surface',
    };

    const parsed = parseEvolutionLineageEntry(renderEvolutionLineageEntry(lineage));
    expect(parsed.ok ? parsed.value : parsed.error).toEqual(lineage);
  });
});
