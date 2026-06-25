import { mkdir } from 'node:fs/promises';
import { join as joinPath } from 'node:path';

import { Command, Option } from 'clipanion';

import { FugueCcHarness } from '../../adapters/harness/fugue-cc-harness.js';
import { DEFAULT_PLAN_AGENTS } from '../../domain/plan.js';
import { isOk } from '../../domain/result.js';
import { NodeCommandRunner } from '../../infra/node-command-runner.js';

const parseModels = (raw: string): readonly string[] =>
  raw
    .split(',')
    .map((model) => model.trim())
    .filter((model) => model.length > 0);

const promptFor = (model: string, goal: string, outfile: string): string =>
  [
    `Your role: planner (${model}). Decompose the goal below into a plan of subtasks that can run in parallel.`,
    '',
    `Goal: ${goal}`,
    '',
    'Requirements:',
    "1. List 3-6 subtasks, each annotated: scope (one sentence) + suggested implementer model (by each model's strength) + files to change",
    '2. Mark dependencies/ordering (write out what must be serial); the rest defaults to parallel',
    '3. Give 1 acceptance point per subtask',
    '4. End with one "overall acceptance gate" (a runnable command, e.g. `pytest -q && npm run build`)',
    '',
    `Output: **must use the Write tool to write to ${outfile}** (NOT chat! chat gets lost), Markdown.`,
  ].join('\n');

export class PlanCommand extends Command {
  static override paths = [['plan']];

  goal = Option.String();
  models = Option.String('--models', DEFAULT_PLAN_AGENTS.join(','));
  out = Option.String('--out', { required: true });
  bin = Option.String('--bin', 'fugue-cc');

  override async execute(): Promise<number> {
    const agents = parseModels(this.models);
    if (agents.length === 0) {
      this.context.stderr.write('no planning models specified\n');
      return 2;
    }
    await mkdir(this.out, { recursive: true });

    const harness = new FugueCcHarness(new NodeCommandRunner(), { bin: this.bin });
    const requests = agents.map((agent) => ({
      agent,
      outfile: joinPath(this.out, `${agent}.plan.md`),
    }));
    const results = await Promise.all(
      requests.map(async ({ agent, outfile }) => {
        const result = await harness.dispatch({
          agent,
          prompt: promptFor(agent, this.goal, outfile),
        });
        return { agent, outfile, result };
      }),
    );

    const lines = [`── planning panel: goal decomposition → ${agents.join(' ')} ──`];
    for (const entry of results) {
      lines.push(
        isOk(entry.result)
          ? `  → dispatched to ${entry.agent}, plan will be written to ${entry.outfile}`
          : `  ✗ ${entry.agent} dispatch failed`,
      );
    }

    lines.push(
      '',
      'collect: after each model finishes writing, the planner reads these plans and synthesizes the final plan:',
    );
    for (const entry of requests) lines.push(`  ${entry.outfile}`);
    this.context.stdout.write(`${lines.join('\n')}\n`);
    return 0;
  }
}
