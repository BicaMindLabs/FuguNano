import type {
  RuntimeGuardFinding,
  RuntimeGuardFindingKind,
  RuntimeGuardPacket,
  RuntimeGuardSeverity,
} from './runtime-guard.js';

export type EvolutionSurfaceHint = 'guard-rule';

export interface WeaknessEvidenceLine {
  readonly line: number;
  readonly excerpt: string;
}

export interface WeaknessSignal {
  readonly sourceRef: string;
  readonly sourceSha256: string;
  readonly kind: RuntimeGuardFindingKind;
  readonly surfaceHint: EvolutionSurfaceHint;
  readonly cause: string;
  readonly severity: RuntimeGuardSeverity;
  readonly evidenceLines: readonly WeaknessEvidenceLine[];
  readonly suggestedChecks: readonly string[];
}

const toSignal = (packet: RuntimeGuardPacket, finding: RuntimeGuardFinding): WeaknessSignal => ({
  sourceRef: packet.sourceRef,
  sourceSha256: packet.sourceSha256,
  kind: finding.kind,
  surfaceHint: 'guard-rule',
  cause: finding.summary,
  severity: finding.severity,
  evidenceLines: finding.evidence.map((item) => ({
    line: item.line,
    excerpt: item.excerpt,
  })),
  suggestedChecks: finding.recommendedChecks,
});

/** Convert runtime-guard findings into evolution weakness signals for the guard-rule surface. */
export const guardPacketWeaknessSignals = (packet: RuntimeGuardPacket): readonly WeaknessSignal[] =>
  packet.findings.map((finding) => toSignal(packet, finding));
