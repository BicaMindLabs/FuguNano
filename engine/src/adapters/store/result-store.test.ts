import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';

import type { Artifact, ArtifactKind } from '../../domain/artifact.js';
import type { ResultStore } from '../../domain/ports/result-store.js';
import { MemoryFileSystem } from '../../infra/memory-file-system.js';
import { FsResultStore } from './fs-result-store.js';
import { InMemoryResultStore } from './in-memory-result-store.js';

const clock = { now: (): number => 1_000 };

const artifact = (id: string): Artifact => ({
  id,
  kind: 'log',
  uri: `memory://${id}`,
  sha256: `sha256-${id}`,
});

const artifactArbitrary = fc.record<Artifact>({
  id: fc.string(),
  kind: fc.constantFrom<ArtifactKind>('diff', 'file', 'log', 'plan'),
  uri: fc.string(),
  sha256: fc.string(),
});

const storeFactories: readonly [string, () => ResultStore][] = [
  ['InMemoryResultStore', () => new InMemoryResultStore()],
  ['FsResultStore', () => new FsResultStore(new MemoryFileSystem(clock), '/results')],
];

describe.each(storeFactories)('%s', (_name, makeStore) => {
  it('put then get returns equal artifacts', async () => {
    const store = makeStore();
    const artifacts = [artifact('a'), artifact('b')];

    await store.put('task-a', artifacts);

    expect(await store.get('task-a')).toEqual(artifacts);
  });

  it('get returns null for a missing key', async () => {
    const store = makeStore();

    expect(await store.get('missing')).toBeNull();
  });

  it('keys lists what was put', async () => {
    const store = makeStore();

    await store.put('task-a', [artifact('a')]);
    await store.put('task-b', [artifact('b')]);

    expect(new Set(await store.keys())).toEqual(new Set(['task-a', 'task-b']));
  });

  it('round-trips arbitrary key and artifact lists (property)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string(),
        fc.array(artifactArbitrary, { maxLength: 8 }),
        async (key, artifacts) => {
          const store = makeStore();

          await store.put(key, artifacts);

          expect(await store.get(key)).toEqual(artifacts);
        },
      ),
    );
  });
});

describe('FsResultStore', () => {
  it('skips corrupt json files while listing keys', async () => {
    const fs = new MemoryFileSystem(clock);
    const store = new FsResultStore(fs, '/results');

    await store.put('task-a', [artifact('a')]);
    await fs.write('/results/corrupt.json', '{not json');
    await fs.write('/results/not-a-result.json', JSON.stringify({ key: 'bad', artifacts: [{}] }));

    expect(await store.keys()).toEqual(['task-a']);
  });
});
