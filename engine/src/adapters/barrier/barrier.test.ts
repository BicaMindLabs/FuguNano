import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';

import type { RoundManifest } from '../../domain/round.js';
import { isComplete, stateOf } from '../../domain/round.js';
import type { TaskState } from '../../domain/task.js';
import { isTerminal } from '../../domain/task.js';
import { MemoryFileSystem } from '../../infra/memory-file-system.js';
import { systemClock } from '../../infra/clock.js';
import { PersistentBarrier } from './persistent-barrier.js';

const taskStateArbitrary = fc.constantFrom<TaskState>(
  'pending',
  'done',
  'fail',
  'timeout',
  'canceled',
);
const terminalStateArbitrary = fc.constantFrom<TaskState>('done', 'fail', 'timeout', 'canceled');
const expectedArbitrary = fc.uniqueArray(fc.string(), { maxLength: 8 });

// The barrier is clock-free; MemoryFileSystem just needs a clock for mtime.
const makeBarrier = (): PersistentBarrier =>
  new PersistentBarrier(new MemoryFileSystem(systemClock), '/barriers');

const inspected = async (barrier: PersistentBarrier, round: number): Promise<RoundManifest> => {
  const manifest = await barrier.inspect(round);
  if (manifest === null) throw new Error(`Round ${round} was not opened`);
  return manifest;
};

describe('PersistentBarrier', () => {
  it('open creates a manifest where all expected keys are pending', async () => {
    const barrier = makeBarrier();

    await barrier.open(1, ['a', 'b']);
    const manifest = await inspected(barrier, 1);

    expect(manifest.expected).toEqual(['a', 'b']);
    expect(stateOf(manifest, 'a')).toBe('pending');
    expect(stateOf(manifest, 'b')).toBe('pending');
  });

  it('open is idempotent for the same expected set and keeps prior marks', async () => {
    const barrier = makeBarrier();

    await barrier.open(1, ['a', 'b']);
    await barrier.mark(1, 'a', 'done');
    await barrier.open(1, ['a', 'b']); // re-open: must not wipe 'a'

    expect(stateOf(await inspected(barrier, 1), 'a')).toBe('done');
  });

  it('open throws if reopened with a different expected set (never drops a key)', async () => {
    const barrier = makeBarrier();

    await barrier.open(1, ['a', 'b']);
    await expect(barrier.open(1, ['a'])).rejects.toThrow(/different expected set/u);
  });

  it('mark is reflected in inspect', async () => {
    const barrier = makeBarrier();

    await barrier.open(1, ['a']);
    await barrier.mark(1, 'a', 'done');

    expect(stateOf(await inspected(barrier, 1), 'a')).toBe('done');
  });

  it('settle expires still-pending keys to timeout and keeps terminals', async () => {
    const barrier = makeBarrier();

    await barrier.open(1, ['a', 'b', 'c']);
    await barrier.mark(1, 'a', 'done');
    await barrier.mark(1, 'b', 'fail');
    const settled = await barrier.settle(1);

    expect(stateOf(settled, 'a')).toBe('done');
    expect(stateOf(settled, 'b')).toBe('fail');
    expect(stateOf(settled, 'c')).toBe('timeout');
    expect(isComplete(settled)).toBe(true);
  });

  it('concurrent marks do not lose updates (join invariant)', async () => {
    const barrier = makeBarrier();

    await barrier.open(1, ['a', 'b', 'c', 'd', 'e']);
    await Promise.all([
      barrier.mark(1, 'a', 'done'),
      barrier.mark(1, 'b', 'done'),
      barrier.mark(1, 'c', 'fail'),
      barrier.mark(1, 'd', 'done'),
      barrier.mark(1, 'e', 'canceled'),
    ]);

    const m = await inspected(barrier, 1);
    expect(isComplete(m)).toBe(true);
    expect(stateOf(m, 'a')).toBe('done');
    expect(stateOf(m, 'b')).toBe('done');
    expect(stateOf(m, 'c')).toBe('fail');
    expect(stateOf(m, 'd')).toBe('done');
    expect(stateOf(m, 'e')).toBe('canceled');
  });

  it('isComplete becomes true once all expected keys are terminal', async () => {
    const barrier = makeBarrier();

    await barrier.open(1, ['a', 'b']);
    await barrier.mark(1, 'a', 'done');
    expect(isComplete(await inspected(barrier, 1))).toBe(false);

    await barrier.mark(1, 'b', 'canceled');
    expect(isComplete(await inspected(barrier, 1))).toBe(true);
  });

  it('isComplete(inspect) iff every expected key is terminal (property)', async () => {
    await fc.assert(
      fc.asyncProperty(
        expectedArbitrary,
        fc.array(fc.tuple(fc.string(), taskStateArbitrary), { maxLength: 20 }),
        async (expected, marks) => {
          const barrier = makeBarrier();
          const finalStates = new Map<string, TaskState>();

          await barrier.open(1, expected);
          for (const [key, state] of marks) {
            await barrier.mark(1, key, state);
            finalStates.set(key, state);
          }

          const manifest = await inspected(barrier, 1);
          const everyExpectedTerminal = expected.every((key) =>
            isTerminal(finalStates.get(key) ?? 'pending'),
          );
          expect(isComplete(manifest)).toBe(everyExpectedTerminal);
        },
      ),
    );
  });

  it('settle is idempotent (property)', async () => {
    await fc.assert(
      fc.asyncProperty(
        expectedArbitrary,
        fc.array(fc.tuple(fc.string(), taskStateArbitrary), { maxLength: 20 }),
        async (expected, marks) => {
          const barrier = makeBarrier();

          await barrier.open(1, expected);
          for (const [key, state] of marks) await barrier.mark(1, key, state);

          const once = await barrier.settle(1);
          const twice = await barrier.settle(1);

          expect(twice).toEqual(once);
          expect(isComplete(once)).toBe(true);
        },
      ),
    );
  });

  it('settle is a no-op when all expected keys are already terminal (property)', async () => {
    await fc.assert(
      fc.asyncProperty(
        expectedArbitrary.chain((expected) =>
          fc.record({
            expected: fc.constant(expected),
            terminalStates: fc.array(terminalStateArbitrary, {
              minLength: expected.length,
              maxLength: expected.length,
            }),
          }),
        ),
        async ({ expected, terminalStates }) => {
          const barrier = makeBarrier();

          await barrier.open(1, expected);
          for (const [index, key] of expected.entries()) {
            const state = terminalStates[index];
            if (state !== undefined) await barrier.mark(1, key, state);
          }

          const before = await inspected(barrier, 1);
          const settled = await barrier.settle(1);

          expect(settled).toEqual(before);
        },
      ),
    );
  });
});
