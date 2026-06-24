import { describe, expect, it } from 'vitest';

import { isGo } from '../../domain/gate.js';
import type { GoalSpec } from '../../domain/goal.js';
import type { CommandResult, CommandRunner } from '../../infra/command-runner.js';
import { runGoalGate } from './goal-gate.js';

const spec = (gate: string): GoalSpec => ({
  outcome: 'o',
  gate,
  rubric: 'r',
  rounds: 3,
  allocate: 'auto',
});

class Runner implements CommandRunner {
  readonly calls: string[][] = [];
  constructor(private readonly result: Partial<CommandResult>) {}
  run(_command: string, args: readonly string[]): Promise<CommandResult> {
    this.calls.push([...args]);
    return Promise.resolve({ code: 0, stdout: '', stderr: '', ...this.result });
  }
}

describe('runGoalGate', () => {
  it('runs the gate via sh -c and passes on exit 0', async () => {
    const runner = new Runner({ code: 0 });
    const result = await runGoalGate(runner, spec('pytest -q'));
    expect(runner.calls[0]).toEqual(['-c', 'pytest -q']);
    expect(isGo(result)).toBe(true);
  });

  it('fails the gate on a nonzero exit', async () => {
    const result = await runGoalGate(new Runner({ code: 1, stderr: 'boom' }), spec('false'));
    expect(isGo(result)).toBe(false);
  });

  it('warns (not fails) when the spec has no gate', async () => {
    const result = await runGoalGate(new Runner({ code: 0 }), spec('  '));
    expect(isGo(result)).toBe(true);
    expect(result.checks[0]?.severity).toBe('warn');
  });
});
