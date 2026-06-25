import type { Artifact } from '../domain/artifact.js';
import type { GateResult } from '../domain/gate.js';
import { isGo } from '../domain/gate.js';
import type { Policy, Selection } from '../domain/policy.js';
import { evaluatePolicies, policyResultToGate } from '../domain/policy-eval.js';
import type { AllocationStrategy } from '../domain/ports/allocation-strategy.js';
import type { Barrier } from '../domain/ports/barrier.js';
import type { Harness } from '../domain/ports/harness.js';
import type { ResultStore } from '../domain/ports/result-store.js';
import type { RunStore } from '../domain/ports/run-store.js';
import { isOk } from '../domain/result.js';
import type { RoundManifest } from '../domain/round.js';

/** One unit of work to dispatch (agent optional — the allocator picks the top-ranked when absent). */
export interface DispatchTask {
  readonly key: string;
  readonly taskType: string;
  readonly prompt: string;
  readonly agent?: string;
}

export interface RunReport {
  readonly runId: string;
  readonly status: 'completed' | 'no-go';
  readonly gate: GateResult;
  readonly manifest?: RoundManifest;
}

export interface CoordinatorDeps {
  readonly policies: readonly Policy[];
  readonly allocator: AllocationStrategy;
  readonly harness: Harness;
  readonly barrier: Barrier;
  readonly resultStore: ResultStore;
  readonly runStore: RunStore;
  /** Injected time source (structural — keeps the app layer off infra). */
  readonly clock: { readonly now: () => number };
  /** Injected content hash for artifact pinning (e.g. sha256-hex). */
  readonly hash: (content: string) => string;
}

/**
 * "Our own thing": composes the ports into the dispatch join. Picks agents
 * (allocator), enforces run policy (no-Gemini / gen≠review), dispatches in
 * parallel over a harness, tracks the join barrier, and records run events —
 * the engine analogue of Fugu's coordinator, training-free.
 */
export class Coordinator {
  constructor(private readonly deps: CoordinatorDeps) {}

  /** Resolve agents, gate on policy, then dispatch all tasks for one round and collect (N ⇒ N terminal). */
  async dispatchRound(
    runId: string,
    round: number,
    tasks: readonly DispatchTask[],
  ): Promise<RunReport> {
    const keys = new Set<string>();
    for (const t of tasks) {
      if (keys.has(t.key)) throw new Error(`duplicate task key: ${t.key}`);
      keys.add(t.key);
    }

    const resolved = await Promise.all(
      tasks.map(async (task) => ({ task, agent: await this.resolveAgent(task) })),
    );

    const implementers = resolved
      .map((r) => r.agent)
      .filter((agent): agent is string => agent !== undefined);
    const selection: Selection = { implementers };
    const gate = policyResultToGate(evaluatePolicies(this.deps.policies, selection));
    if (!isGo(gate)) return { runId, status: 'no-go', gate };

    await this.deps.runStore.create(runId, 'dispatch');
    await this.deps.barrier.open(
      round,
      resolved.map((r) => r.task.key),
    );

    await Promise.all(resolved.map((r) => this.dispatchOne(runId, round, r.task, r.agent)));

    const manifest = await this.deps.barrier.inspect(round);
    if (manifest === null) throw new Error(`round ${round} vanished`);
    return { runId, status: 'completed', gate, manifest };
  }

  private async resolveAgent(task: DispatchTask): Promise<string | undefined> {
    if (task.agent !== undefined) return task.agent;
    const ranked = await this.deps.allocator.rank({ taskType: task.taskType });
    return ranked[0]?.agent;
  }

  private async dispatchOne(
    runId: string,
    round: number,
    task: DispatchTask,
    agent: string | undefined,
  ): Promise<void> {
    if (agent === undefined) {
      await this.deps.barrier.mark(round, task.key, 'fail');
      await this.event(runId, 'no-agent', task.key);
      return;
    }
    const result = await this.deps.harness.dispatch({
      agent,
      prompt: task.prompt,
      taskType: task.taskType,
    });
    if (isOk(result)) {
      const artifact: Artifact = {
        id: task.key,
        kind: 'log',
        uri: `result://${task.key}`,
        sha256: this.deps.hash(result.value.output),
      };
      await this.deps.resultStore.put(task.key, [artifact]);
      await this.deps.barrier.mark(round, task.key, 'done');
      await this.event(runId, 'dispatched', `${task.key} → ${agent}`);
    } else {
      await this.deps.barrier.mark(round, task.key, 'fail');
      await this.event(runId, 'failed', `${task.key}: ${result.error.detail}`);
    }
  }

  private async event(runId: string, kind: string, detail: string): Promise<void> {
    await this.deps.runStore.appendEvent(runId, {
      at: this.deps.clock.now(),
      phase: 'dispatch',
      kind,
      detail,
    });
  }
}
