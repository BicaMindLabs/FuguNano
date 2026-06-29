import { describe, expect, it } from 'vitest';

import { runtimeGuardPacket } from './runtime-guard.js';
import { guardPacketWeaknessSignals } from './evolution-evidence.js';

describe('guardPacketWeaknessSignals', () => {
  it('maps runtime guard findings into guard-rule weakness signals', () => {
    const packet = runtimeGuardPacket('Run npm publish without an action certificate.', {
      sourceRef: '/tmp/release-task.md',
      sourceSha256: 'sha-release',
    });

    const signals = guardPacketWeaknessSignals(packet);

    expect(signals).toEqual([
      {
        sourceRef: '/tmp/release-task.md',
        sourceSha256: 'sha-release',
        kind: 'privileged-action-without-certificate',
        surfaceHint: 'guard-rule',
        cause: 'privileged runtime action lacks an action certificate marker',
        severity: 'major',
        evidenceLines: [{ line: 1, excerpt: 'Run npm publish without an action certificate.' }],
        suggestedChecks: [
          'add dispatch --certificate for replay-ready action provenance',
          'record externalities and assumptions before executing the action',
        ],
      },
    ]);
  });

  it('returns no signals for a clean packet', () => {
    const packet = runtimeGuardPacket('Summarize the local TASK file.', {
      sourceRef: '/tmp/TASK.md',
      sourceSha256: 'sha-task',
    });

    expect(guardPacketWeaknessSignals(packet)).toEqual([]);
  });
});
