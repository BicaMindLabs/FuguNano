import { describe, expect, it } from 'vitest';

import { SelfHarnessLoop } from '../../app/self-harness-loop.js';
import type {
  DispatchError,
  DispatchRequest,
  DispatchResult,
  HealthStatus,
} from '../../domain/dispatch.js';
import type { Harness } from '../../domain/ports/harness.js';
import type { RunStore } from '../../domain/ports/run-store.js';
import { ok } from '../../domain/result.js';
import type { Result } from '../../domain/result.js';
import type { Run } from '../../domain/run.js';
import type { HarnessConfig } from '../../domain/self-harness.js';
import { HarnessBackedProposer } from './harness-proposer.js';
import { RunWeaknessMiner } from './run-weakness-miner.js';
import { TaskListHarnessValidator } from './task-list-validator.js';

/**
 * Integration smoke test for the whole Self-Harness pipeline: the REAL adapters
 * (miner → proposer → validator) and the app loop, driven by a scripted in-process
 * "brain" so it is deterministic and CI-safe. This is the wired-together version of
 * the manual real-model run, locked in so future churn cannot silently break it.
 */
class ScriptedHarness implements Harness {
  readonly name = 'codex';
  readonly prompts: string[] = [];

  dispatch(request: DispatchRequest): Promise<Result<DispatchResult, DispatchError>> {
    this.prompts.push(request.prompt);
    const output = this.brain(request.prompt);
    return Promise.resolve(ok({ agent: request.agent, output, exitCode: 0 }));
  }

  health(): Promise<HealthStatus> {
    return Promise.resolve({ healthy: true, detail: 'ok' });
  }

  private brain(prompt: string): string {
    if (prompt.includes('Weakness Mining')) {
      return JSON.stringify([
        {
          taskKey: 'verbose-task',
          cause: 'replied with a full sentence instead of the bare answer',
          causalStatus: 'causal',
          mechanism: 'enforce-output-only',
        },
      ]);
    }
    if (prompt.includes('Harness Proposal')) {
      // fenced + prose around the array, to also exercise json-extract robustness.
      return [
        'Here is my proposal:',
        '```json',
        JSON.stringify([
          {
            surface: 'execution',
            mechanism: 'enforce-output-only',
            after: 'OUTPUT_ONLY: reply with just the bare answer, no sentence.',
            rationale: 'addresses enforce-output-only',
          },
        ]),
        '```',
      ].join('\n');
    }
    // eval: only a config carrying the injected policy yields the passing answer.
    return prompt.includes('OUTPUT_ONLY') ? 'PASS' : 'Sure! Here is a long verbose answer.';
  }
}

const runWithFailure: Run = {
  id: 'run-1',
  phase: 'dispatch',
  round: 1,
  events: [
    { at: 1, phase: 'dispatch', kind: 'dispatched', detail: 'verbose-task -> agent-1' },
    {
      at: 2,
      phase: 'dispatch',
      kind: 'failed',
      detail: 'verbose-task: model replied with a full sentence instead of the bare answer',
    },
  ],
};

class FixedRunStore implements RunStore {
  create(): Promise<Run> {
    return Promise.resolve(runWithFailure);
  }
  get(): Promise<Run | null> {
    return Promise.resolve(runWithFailure);
  }
  patch(): Promise<Run> {
    return Promise.resolve(runWithFailure);
  }
  appendEvent(): Promise<Run> {
    return Promise.resolve(runWithFailure);
  }
}

const emptyConfig: HarnessConfig = {
  'system-prompt': '',
  'memory-sources': '',
  subagents: '',
  skills: '',
  bootstrap: '',
  execution: '',
  verification: '',
  'failure-recovery': '',
  'runtime-policy': '',
};

interface EvalCase {
  readonly key: string;
  readonly q: string;
}

const renderPrompt = (config: HarnessConfig, testCase: EvalCase): string =>
  [config.execution, testCase.q].filter((s) => s.length > 0).join('\n');

const verify = (_testCase: EvalCase, result: DispatchResult): boolean => result.output === 'PASS';

describe('Self-Harness pipeline (real adapters, scripted brain)', () => {
  it('mines a failure, proposes a fix, and promotes the edit that improves both splits', async () => {
    const harness = new ScriptedHarness();
    const loop = new SelfHarnessLoop({
      miner: new RunWeaknessMiner(new FixedRunStore(), harness, { agent: 'agent-1' }),
      proposer: new HarnessBackedProposer(harness, { agent: 'agent-1' }),
      validator: new TaskListHarnessValidator<EvalCase>(harness, {
        heldIn: [{ key: 'in', q: 'name a fruit' }],
        heldOut: [{ key: 'out', q: 'name a color' }],
        agent: 'agent-1',
        renderPrompt,
        verify,
      }),
      k: 1,
    });

    const result = await loop.runRound(1, 'run-1', emptyConfig);

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0]?.surface).toBe('execution');
    expect(result.config.execution).toContain('OUTPUT_ONLY');

    const promoted = result.lineage.filter((entry) => entry.decision === 'accepted');
    expect(promoted).toHaveLength(1);
    expect(promoted[0]?.verdict.deltaIn).toBe(1);
    expect(promoted[0]?.verdict.deltaOut).toBe(1);
  });

  it('promotes nothing when the proposed edit does not improve evaluation', async () => {
    // A harness whose eval never passes -> no edit can raise a split -> gate rejects all.
    class NeverPassHarness extends ScriptedHarness {
      override dispatch(request: DispatchRequest): Promise<Result<DispatchResult, DispatchError>> {
        if (
          request.prompt.includes('Weakness Mining') ||
          request.prompt.includes('Harness Proposal')
        ) {
          return super.dispatch(request);
        }
        return Promise.resolve(ok({ agent: request.agent, output: 'still verbose', exitCode: 0 }));
      }
    }
    const loop = new SelfHarnessLoop({
      miner: new RunWeaknessMiner(new FixedRunStore(), new NeverPassHarness(), { agent: 'a' }),
      proposer: new HarnessBackedProposer(new NeverPassHarness(), { agent: 'a' }),
      validator: new TaskListHarnessValidator<EvalCase>(new NeverPassHarness(), {
        heldIn: [{ key: 'in', q: 'name a fruit' }],
        heldOut: [{ key: 'out', q: 'name a color' }],
        agent: 'a',
        renderPrompt,
        verify,
      }),
      k: 1,
    });

    const result = await loop.runRound(1, 'run-1', emptyConfig);

    expect(result.accepted).toHaveLength(0);
    expect(result.config).toEqual(emptyConfig);
  });
});
