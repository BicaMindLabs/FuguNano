import { describe, expect, it } from 'vitest';

import type { Ranking, StrategyState } from '../domain/allocation.js';
import type {
  DispatchError,
  DispatchRequest,
  DispatchResult,
  HealthStatus,
} from '../domain/dispatch.js';
import type { Artifact } from '../domain/artifact.js';
import type { AllocationStrategy } from '../domain/ports/allocation-strategy.js';
import type { Barrier } from '../domain/ports/barrier.js';
import type { Harness } from '../domain/ports/harness.js';
import type { ResultStore } from '../domain/ports/result-store.js';
import type { RunStore } from '../domain/ports/run-store.js';
import { DEFAULT_POLICIES } from '../domain/policy-eval.js';
import { err, ok } from '../domain/result.js';
import type { Result } from '../domain/result.js';
import { stateOf } from '../domain/round.js';
import type { RoundManifest } from '../domain/round.js';
import type { Run, RunEvent } from '../domain/run.js';
import type { TaskState } from '../domain/task.js';
import { Coordinator, type CoordinatorDeps, type DispatchTask } from './coordinator.js';

// ── minimal in-test fakes (app tests may not import infra/adapters) ──
class FakeHarness implements Harness {
  readonly name = 'fugue-cc';
  readonly dispatched: string[] = [];
  constructor(private readonly failAgents: ReadonlySet<string> = new Set()) {}
  dispatch(request: DispatchRequest): Promise<Result<DispatchResult, DispatchError>> {
    this.dispatched.push(request.agent);
    return Promise.resolve(
      this.failAgents.has(request.agent)
        ? err({ agent: request.agent, kind: 'nonzero-exit', detail: 'boom', exitCode: 1 })
        : ok({ agent: request.agent, output: 'done', exitCode: 0 }),
    );
  }
  health(): Promise<HealthStatus> {
    return Promise.resolve({ healthy: true, detail: 'ok' });
  }
}

class FakeAllocator implements AllocationStrategy {
  constructor(private readonly top: string) {}
  rank(): Promise<Ranking> {
    return Promise.resolve([{ agent: this.top, score: 0.9, benchRank: 1 }]);
  }
  update(): Promise<void> {
    return Promise.resolve();
  }
  decay(): Promise<void> {
    return Promise.resolve();
  }
  snapshot(): Promise<StrategyState> {
    return Promise.resolve([]);
  }
}

class FakeBarrier implements Barrier {
  private readonly states = new Map<string, TaskState>();
  private expected: string[] = [];
  private round = 0;
  open(round: number, expected: readonly string[]): Promise<void> {
    this.round = round;
    this.expected = [...expected];
    for (const k of expected) this.states.set(k, 'pending');
    return Promise.resolve();
  }
  mark(_round: number, key: string, state: TaskState): Promise<void> {
    this.states.set(key, state);
    return Promise.resolve();
  }
  inspect(round: number): Promise<RoundManifest | null> {
    if (round !== this.round) return Promise.resolve(null);
    return Promise.resolve({
      round,
      expected: this.expected,
      states: Object.fromEntries(this.states),
    });
  }
  settle(round: number): Promise<RoundManifest> {
    return this.inspect(round).then((m) => {
      if (m === null) throw new Error('no round');
      return m;
    });
  }
}

class FakeResultStore implements ResultStore {
  readonly store = new Map<string, readonly Artifact[]>();
  put(key: string, artifacts: readonly Artifact[]): Promise<void> {
    this.store.set(key, artifacts);
    return Promise.resolve();
  }
  get(key: string): Promise<readonly Artifact[] | null> {
    return Promise.resolve(this.store.get(key) ?? null);
  }
  keys(): Promise<readonly string[]> {
    return Promise.resolve([...this.store.keys()]);
  }
}

class FakeRunStore implements RunStore {
  readonly events: RunEvent[] = [];
  private run: Run = { id: '', phase: 'plan', round: 0, events: [] };
  create(id: string): Promise<Run> {
    this.run = { id, phase: 'dispatch', round: 0, events: [] };
    return Promise.resolve(this.run);
  }
  get(): Promise<Run | null> {
    return Promise.resolve(this.run);
  }
  patch(): Promise<Run> {
    return Promise.resolve(this.run);
  }
  appendEvent(_id: string, event: RunEvent): Promise<Run> {
    this.events.push(event);
    return Promise.resolve(this.run);
  }
}

const deps = (overrides: Partial<CoordinatorDeps> = {}): CoordinatorDeps => ({
  policies: DEFAULT_POLICIES,
  allocator: new FakeAllocator('deepseek'),
  harness: new FakeHarness(),
  barrier: new FakeBarrier(),
  resultStore: new FakeResultStore(),
  runStore: new FakeRunStore(),
  clock: { now: () => 0 },
  hash: (content) => `sha-${String(content.length)}`,
  ...overrides,
});

const task = (key: string, agent?: string): DispatchTask =>
  agent !== undefined
    ? { key, taskType: 'code', prompt: 'do it', agent }
    : { key, taskType: 'code', prompt: 'do it' };

describe('Coordinator.dispatchRound', () => {
  it('dispatches all tasks and reports a complete manifest', async () => {
    const report = await new Coordinator(deps()).dispatchRound('run-1', 1, [
      task('a', 'deepseek'),
      task('b', 'glm'),
    ]);
    expect(report.status).toBe('completed');
    expect(report.manifest && stateOf(report.manifest, 'a')).toBe('done');
    expect(report.manifest && stateOf(report.manifest, 'b')).toBe('done');
  });

  it('blocks (no-go) on a policy violation and dispatches nothing', async () => {
    const harness = new FakeHarness();
    const report = await new Coordinator(deps({ harness })).dispatchRound('run-2', 1, [
      task('a', 'gemini-pro'),
    ]);
    expect(report.status).toBe('no-go');
    expect(harness.dispatched).toHaveLength(0);
  });

  it('lets the allocator pick the agent when none is given', async () => {
    const harness = new FakeHarness();
    await new Coordinator(deps({ harness, allocator: new FakeAllocator('kimi') })).dispatchRound(
      'run-3',
      1,
      [task('a')],
    );
    expect(harness.dispatched).toEqual(['kimi']);
  });

  it('marks a failed dispatch as fail in the manifest', async () => {
    const harness = new FakeHarness(new Set(['glm']));
    const report = await new Coordinator(deps({ harness })).dispatchRound('run-4', 1, [
      task('a', 'glm'),
    ]);
    expect(report.manifest && stateOf(report.manifest, 'a')).toBe('fail');
  });

  it('rejects duplicate task keys', async () => {
    await expect(
      new Coordinator(deps()).dispatchRound('run-5', 1, [task('a', 'x'), task('a', 'y')]),
    ).rejects.toThrow(/duplicate task key/u);
  });
});
