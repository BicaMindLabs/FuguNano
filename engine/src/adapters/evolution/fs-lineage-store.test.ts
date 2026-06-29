import { describe, expect, it } from 'vitest';

import type { EvolutionLineageEntry } from '../../domain/evolution-lineage.js';
import { isErr, isOk } from '../../domain/result.js';
import { MemoryFileSystem } from '../../infra/memory-file-system.js';
import type { Clock } from '../../infra/clock.js';
import { FsLineageStore } from './fs-lineage-store.js';

const clock: Clock = { now: () => 1_000 };

const entry = (id: string, supersedes: readonly string[] = []): EvolutionLineageEntry => ({
  id,
  surface: 'guard-rule',
  candidateId: `candidate-${id}`,
  evidenceRefs: [{ sourceRef: '/tmp/source.md', sourceSha256: 'sha', kind: 'guard' }],
  beforeContent: 'before full content',
  afterSha256: `after-${id}`,
  validationSpecSnapshot: { samples: ['a', 'b'] },
  fitness: {
    heldIn: { pass: 2, total: 2, delta: 1 },
    heldOut: { pass: 2, total: 2, delta: 0 },
    regressions: 0,
    cost: { samples: 4 },
  },
  promotedBy: 'operator',
  rollbackHint: 'restore beforeContent',
  ...(supersedes.length === 0 ? {} : { supersedes }),
});

describe('FsLineageStore', () => {
  it('writes, reads, and lists lineage entries under the root directory', async () => {
    const fs = new MemoryFileSystem(clock);
    const store = new FsLineageStore(fs, '/repo/.fugunano/evolution');
    await store.put(entry('evo-002', ['evo-001']));
    await store.put(entry('evo-001'));

    const got = await store.get('evo-002');
    expect(isOk(got)).toBe(true);
    if (got.ok) expect(got.value.supersedes).toEqual(['evo-001']);

    const listed = await store.list();
    expect(isOk(listed)).toBe(true);
    if (listed.ok) expect(listed.value.map((item) => item.id)).toEqual(['evo-001', 'evo-002']);
  });

  it('returns typed errors for missing or invalid entries', async () => {
    const fs = new MemoryFileSystem(clock);
    const store = new FsLineageStore(fs, '/repo/.fugunano/evolution');
    await fs.write('/repo/.fugunano/evolution/bad.json', '{"id":""}');

    const missing = await store.get('missing');
    expect(isErr(missing)).toBe(true);
    if (!missing.ok) expect(missing.error.kind).toBe('not-found');

    const listed = await store.list();
    expect(isErr(listed)).toBe(true);
    if (!listed.ok) expect(listed.error.kind).toBe('invalid-record');
  });
});
