import type { GateResult } from '../../domain/gate.js';
import type { GoalSpec } from '../../domain/goal.js';
import type { CommandRunner } from '../../infra/command-runner.js';

export interface GoalCheckOptions {
  readonly cwd?: string;
  /** Shell used to run the gate command string (default `sh`). */
  readonly shell?: string;
}

/** Run a goal's deterministic acceptance gate; met iff the command exits 0 (bash `goal check`). */
export const runGoalGate = async (
  runner: CommandRunner,
  spec: GoalSpec,
  options: GoalCheckOptions = {},
): Promise<GateResult> => {
  if (spec.gate.trim().length === 0) {
    return { checks: [{ name: 'goal-gate', severity: 'warn', detail: 'no gate command in spec' }] };
  }
  const result = await runner.run(
    options.shell ?? 'sh',
    ['-c', spec.gate],
    options.cwd !== undefined ? { cwd: options.cwd } : {},
  );
  if (result.code === 0) {
    return { checks: [{ name: 'goal-gate', severity: 'ok', detail: 'gate passed (exit 0)' }] };
  }
  const why = (result.stderr || result.stdout).trim().slice(0, 200);
  return {
    checks: [
      { name: 'goal-gate', severity: 'fail', detail: `gate failed (exit ${result.code}): ${why}` },
    ],
  };
};
