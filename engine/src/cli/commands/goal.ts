import { Command, Option } from 'clipanion';

import { runGoalGate } from '../../adapters/goal/goal-gate.js';
import { isGo } from '../../domain/gate.js';
import { parseGoalSpec } from '../../domain/goal-parse.js';
import { NodeCommandRunner } from '../../infra/node-command-runner.js';
import { NodeFileSystem } from '../../infra/node-file-system.js';

/** `fugue goal check <spec>` — run a goal spec's acceptance gate; exit 0 iff met. */
export class GoalCheckCommand extends Command {
  static override paths = [['goal', 'check']];

  spec = Option.String();

  override async execute(): Promise<number> {
    const text = await new NodeFileSystem().read(this.spec);
    if (text === null) {
      this.context.stderr.write(`no goal spec at ${this.spec}\n`);
      return 1;
    }
    const spec = parseGoalSpec(text);
    const result = await runGoalGate(new NodeCommandRunner(), spec);
    for (const check of result.checks) {
      this.context.stdout.write(`[${check.severity}] ${check.name}: ${check.detail ?? ''}\n`);
    }
    // A spec with no gate command has no deterministic acceptance criterion — never "met"
    // (runGoalGate reports it as a `warn`, which isGo would otherwise pass as GO).
    const met = spec.gate.trim().length > 0 && isGo(result);
    this.context.stdout.write(met ? 'GOAL MET\n' : 'GOAL NOT MET\n');
    return met ? 0 : 1;
  }
}
