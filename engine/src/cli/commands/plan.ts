import { mkdir } from 'node:fs/promises';
import { join as joinPath } from 'node:path';

import { Command, Option } from 'clipanion';

import { CodexHarness } from '../../adapters/harness/codex-harness.js';
import { FugueCcHarness } from '../../adapters/harness/fugue-cc-harness.js';
import { AgyHarness } from '../../adapters/harness/agy-harness.js';
import { OpencodeHarness } from '../../adapters/harness/opencode-harness.js';
import { DEFAULT_PLAN_AGENTS } from '../../domain/plan.js';
import { HARNESS_NAMES, type Harness, type HarnessName } from '../../domain/ports/harness.js';
import { isOk } from '../../domain/result.js';
import { NodeCommandRunner } from '../../infra/node-command-runner.js';
import { defaultCacheRoot } from '../default-paths.js';

const parseModels = (raw: string): readonly string[] =>
  raw
    .split(',')
    .map((model) => model.trim())
    .filter((model) => model.length > 0);

const defaultPlanOut = (): string => joinPath(defaultCacheRoot(import.meta.url), 'plans');

const DEFAULT_CODEX_PLAN_AGENTS = ['gpt-5.5'] as const;
const DEFAULT_OPENCODE_PLAN_AGENTS = ['opencode/deepseek-v4-flash-free'] as const;
const DEFAULT_AGY_PLAN_AGENTS = ['default'] as const;

const isHarnessName = (value: string): value is HarnessName =>
  (HARNESS_NAMES as readonly string[]).includes(value);

const planFilename = (agent: string): string => {
  const slug = agent.replace(/[^A-Za-z0-9._-]+/gu, '_').replace(/^_+|_+$/gu, '');
  return `${slug.length > 0 ? slug : 'agent'}.plan.md`;
};

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

const defaultAgentsFor = (harness: HarnessName): readonly string[] => {
  switch (harness) {
    case 'fugue-cc':
      return DEFAULT_PLAN_AGENTS;
    case 'codex':
      return DEFAULT_CODEX_PLAN_AGENTS;
    case 'opencode':
      return DEFAULT_OPENCODE_PLAN_AGENTS;
    case 'agy':
      return DEFAULT_AGY_PLAN_AGENTS;
  }
};

export class PlanCommand extends Command {
  static override paths = [['plan']];

  goal = Option.String();
  harness = Option.String('--harness', process.env.FUGUE_DEFAULT_HARNESS ?? 'fugue-cc');
  models = Option.String('--models');
  out = Option.String('--out');
  bin = Option.String('--bin', process.env.FUGUE_CC_BIN ?? 'fugue-cc');

  override async execute(): Promise<number> {
    if (!isHarnessName(this.harness)) {
      this.context.stderr.write(`unknown harness '${this.harness}' (${HARNESS_NAMES.join('|')})\n`);
      return 2;
    }
    const agents = parseModels(this.models ?? defaultAgentsFor(this.harness).join(','));
    if (agents.length === 0) {
      this.context.stderr.write('no planning models specified\n');
      return 2;
    }
    const outDir = this.out ?? defaultPlanOut();
    await mkdir(outDir, { recursive: true });

    const harness = this.harnessFor(this.harness);
    const requests = agents.map((agent) => ({
      agent,
      outfile: joinPath(outDir, planFilename(agent)),
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

    const lines = [
      `── planning panel: goal decomposition (${this.harness}) → ${agents.join(' ')} ──`,
    ];
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
    return results.every((entry) => isOk(entry.result)) ? 0 : 1;
  }

  private harnessFor(name: HarnessName): Harness {
    const runner = new NodeCommandRunner();
    switch (name) {
      case 'fugue-cc':
        return new FugueCcHarness(runner, { bin: this.bin });
      case 'codex':
        return new CodexHarness(runner, { bin: process.env.FUGUE_CODEX ?? 'codex' });
      case 'opencode':
        return new OpencodeHarness(runner, { bin: process.env.FUGUE_OPENCODE ?? 'opencode' });
      case 'agy':
        return new AgyHarness(runner, { bin: process.env.FUGUE_AGY ?? 'agy' });
    }
  }
}
