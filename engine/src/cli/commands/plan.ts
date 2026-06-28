import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join as joinPath } from 'node:path';
import { performance } from 'node:perf_hooks';

import { Command, Option } from 'clipanion';

import { CodexHarness } from '../../adapters/harness/codex-harness.js';
import { FugueCcHarness } from '../../adapters/harness/fugue-cc-harness.js';
import { AgyHarness } from '../../adapters/harness/agy-harness.js';
import { OpencodeHarness } from '../../adapters/harness/opencode-harness.js';
import { DEFAULT_PLAN_AGENTS } from '../../domain/plan.js';
import { HARNESS_NAMES, type Harness, type HarnessName } from '../../domain/ports/harness.js';
import { isOk } from '../../domain/result.js';
import { NodeCommandRunner } from '../../infra/node-command-runner.js';
import { NodeFileSystem } from '../../infra/node-file-system.js';
import { defaultCacheRoot } from '../default-paths.js';
import { appendTaskAuditLine } from '../task-audit.js';

const parseModels = (raw: string): readonly string[] =>
  raw
    .split(',')
    .map((model) => model.trim())
    .filter((model) => model.length > 0);

const parseTimeoutMs = (raw: string): number | null | undefined => {
  const value = raw.trim();
  if (value.length === 0 || value === '0') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
};

const formatDurationMs = (ms: number): string => {
  if (ms < 1000) return `${String(Math.max(0, Math.round(ms)))}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

const failureFields = (kind: string, exitCode: number | undefined): string =>
  `error=${kind} rc=${String(exitCode ?? 1)}`;

const defaultPlanOut = (): string => joinPath(defaultCacheRoot(import.meta.url), 'plans');

const DEFAULT_CODEX_PLAN_AGENTS = ['gpt-5.5'] as const;
const DEFAULT_OPENCODE_PLAN_AGENTS = ['opencode/deepseek-v4-flash-free'] as const;
const DEFAULT_AGY_PLAN_AGENTS = ['default'] as const;
const LITE_HARNESSES = ['codex', 'opencode', 'agy'] as const satisfies readonly HarnessName[];
type PlanHarness = HarnessName | 'lite';

interface PlanTarget {
  readonly harness: HarnessName;
  readonly agent: string;
}

const isHarnessName = (value: string): value is HarnessName =>
  (HARNESS_NAMES as readonly string[]).includes(value);

const isLiteHarness = (value: string): value is (typeof LITE_HARNESSES)[number] =>
  (LITE_HARNESSES as readonly string[]).includes(value);

const isPlanHarness = (value: string): value is PlanHarness =>
  value === 'lite' || isHarnessName(value);

const planHarnesses = (): string => [...HARNESS_NAMES, 'lite'].join('|');

const targetLabel = (target: PlanTarget): string =>
  target.harness === 'fugue-cc' ? target.agent : `${target.harness}:${target.agent}`;

const planFilename = (agent: string): string => {
  const slug = agent.replace(/[^A-Za-z0-9._-]+/gu, '_').replace(/^_+|_+$/gu, '');
  return `${slug.length > 0 ? slug : 'agent'}.plan.md`;
};

const firstDuplicate = (values: readonly string[]): string | null => {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return null;
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

const ensurePlanArtifact = async (
  outfile: string,
  harnessOutput: string,
): Promise<'written' | 'captured' | null> => {
  try {
    const existing = await readFile(outfile, 'utf8');
    if (existing.trim().length > 0) return 'written';
  } catch {
    // Missing files are expected when a harness returns its plan on stdout.
  }

  const captured = harnessOutput.trim();
  if (captured.length === 0) return null;
  await writeFile(outfile, `${captured}\n`, 'utf8');
  return 'captured';
};

const removePlanArtifact = async (outfile: string): Promise<void> => {
  try {
    await unlink(outfile);
  } catch {
    // A missing artifact is the normal first-run case.
  }
};

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

const defaultTargetsFor = (harness: PlanHarness): readonly PlanTarget[] => {
  if (harness === 'lite') {
    return [
      { harness: 'codex', agent: DEFAULT_CODEX_PLAN_AGENTS[0] },
      { harness: 'opencode', agent: DEFAULT_OPENCODE_PLAN_AGENTS[0] },
      { harness: 'agy', agent: DEFAULT_AGY_PLAN_AGENTS[0] },
    ];
  }
  return defaultAgentsFor(harness).map((agent) => ({ harness, agent }));
};

const parseLiteTarget = (raw: string): PlanTarget | null => {
  const separator = raw.indexOf(':');
  if (separator <= 0) return null;
  const harness = raw.slice(0, separator).trim();
  const agent = raw.slice(separator + 1).trim();
  if (!isLiteHarness(harness) || agent.length === 0) return null;
  return { harness, agent };
};

export class PlanCommand extends Command {
  static override paths = [['plan']];

  goal = Option.String();
  harness = Option.String('--harness', process.env.FUGUE_DEFAULT_HARNESS ?? 'fugue-cc');
  models = Option.String('--models');
  out = Option.String('--out');
  task = Option.String('--task');
  bin = Option.String('--bin', process.env.FUGUE_CC_BIN ?? 'fugue-cc');
  timeoutMs = Option.String('--timeout-ms', process.env.FUGUE_PLAN_TIMEOUT_MS ?? '0');
  allowPartial = Option.Boolean('--allow-partial', false);
  harnessArgs = Option.Array('--harness-arg', []);
  codexArgs = Option.Array('--codex-arg', []);
  opencodeArgs = Option.Array('--opencode-arg', []);
  agyArgs = Option.Array('--agy-arg', []);

  private readonly taskFileSystem = new NodeFileSystem();
  private taskLogQueue: Promise<void> = Promise.resolve();

  override async execute(): Promise<number> {
    if (!isPlanHarness(this.harness)) {
      this.context.stderr.write(`unknown harness '${this.harness}' (${planHarnesses()})\n`);
      return 2;
    }
    const targets = this.planTargetsFor(this.harness);
    if (typeof targets === 'string') {
      this.context.stderr.write(`${targets}\n`);
      return 2;
    }
    if (targets.length === 0) {
      this.context.stderr.write('no planning models specified\n');
      return 2;
    }
    const timeoutMs = parseTimeoutMs(this.timeoutMs);
    if (timeoutMs === null) {
      this.context.stderr.write(
        `invalid --timeout-ms '${this.timeoutMs}' (expected positive ms)\n`,
      );
      return 2;
    }
    const outDir = this.out ?? defaultPlanOut();
    const requests = targets.map((target) => ({
      ...target,
      label: targetLabel(target),
      outfile: joinPath(outDir, planFilename(targetLabel(target))),
    }));
    const duplicateOutfile = firstDuplicate(requests.map((request) => request.outfile));
    if (duplicateOutfile !== null) {
      this.context.stderr.write(
        `planning targets resolve to duplicate artifact path '${duplicateOutfile}' (use distinct --models entries)\n`,
      );
      return 2;
    }
    await mkdir(outDir, { recursive: true });

    for (const request of requests) {
      await this.appendTaskLog(
        `plan → ${request.agent} [${request.harness}] (status=started out=${request.outfile})`,
      );
    }
    const results = await Promise.all(
      requests.map(async ({ harness: harnessName, agent, label, outfile }) => {
        const startedAt = performance.now();
        await removePlanArtifact(outfile);
        const harness = this.harnessFor(harnessName, timeoutMs);
        const result = await harness.dispatch({
          agent,
          prompt: promptFor(label, this.goal, outfile),
        });
        const artifact = isOk(result)
          ? await ensurePlanArtifact(outfile, result.value.output)
          : await ensurePlanArtifact(outfile, '');
        const status = !isOk(result)
          ? artifact === null
            ? 'failed'
            : `failed-${artifact}`
          : (artifact ?? 'missing');
        const elapsedMs = performance.now() - startedAt;
        const detail = isOk(result)
          ? `output_chars=${String(result.value.output.length)}`
          : failureFields(result.error.kind, result.error.exitCode);
        await this.appendTaskLog(
          `plan → ${agent} [${harnessName}] (status=${status} took=${formatDurationMs(
            elapsedMs,
          )} ${detail} out=${outfile})`,
        );
        return { harness: harnessName, agent, label, outfile, result, artifact, elapsedMs };
      }),
    );

    const lines = [
      `── planning panel: goal decomposition (${this.harness}) → ${requests
        .map((request) => request.label)
        .join(' ')} ──`,
    ];
    for (const entry of results) {
      const duration = ` (took ${formatDurationMs(entry.elapsedMs)})`;
      if (!isOk(entry.result) && entry.artifact === null) {
        lines.push(`  ✗ ${entry.label} dispatch failed${duration}`);
      } else if (!isOk(entry.result)) {
        lines.push(
          `  ✗ ${entry.label} dispatch failed but left ${entry.artifact} artifact at ${entry.outfile}${duration}`,
        );
      } else if (entry.artifact === 'written') {
        lines.push(`  → dispatched to ${entry.label}, plan written to ${entry.outfile}${duration}`);
      } else if (entry.artifact === 'captured') {
        lines.push(
          `  → dispatched to ${entry.label}, captured stdout to ${entry.outfile}${duration}`,
        );
      } else {
        lines.push(`  ✗ ${entry.label} produced no plan artifact at ${entry.outfile}${duration}`);
      }
    }

    const availableArtifacts = results.filter((entry) => entry.artifact !== null);
    if (availableArtifacts.length > 0) {
      lines.push('', 'collect: successful plan artifacts available for synthesis:');
      for (const entry of availableArtifacts) lines.push(`  ${entry.outfile}`);
      if (
        this.allowPartial &&
        results.some((entry) => !isOk(entry.result) || entry.artifact === null)
      ) {
        lines.push('partial: --allow-partial accepted available artifacts despite failures');
      }
    } else {
      lines.push(
        '',
        'collect: no plan artifacts were written; inspect failures above and TASK log.',
      );
    }
    this.context.stdout.write(`${lines.join('\n')}\n`);
    const allSucceeded = results.every((entry) => isOk(entry.result) && entry.artifact !== null);
    const partialAccepted = this.allowPartial && availableArtifacts.length > 0;
    return allSucceeded || partialAccepted ? 0 : 1;
  }

  private appendTaskLog(message: string): Promise<void> {
    if (this.task === undefined) return Promise.resolve();
    const write = async (): Promise<void> => {
      if (this.task === undefined) return;
      await appendTaskAuditLine(this.taskFileSystem, this.task, message);
    };
    this.taskLogQueue = this.taskLogQueue.then(write, write);
    return this.taskLogQueue;
  }

  private planTargetsFor(harness: PlanHarness): readonly PlanTarget[] | string {
    if (this.models === undefined) return defaultTargetsFor(harness);
    const models = parseModels(this.models);
    if (harness !== 'lite') return models.map((agent) => ({ harness, agent }));
    const parsed = models.map(parseLiteTarget);
    if (parsed.some((target) => target === null)) {
      return 'lite planning models must be prefixed as codex:<model>, opencode:<provider/model>, or agy:<model|default>';
    }
    return parsed.filter((target): target is PlanTarget => target !== null);
  }

  private argsFor(name: HarnessName): readonly string[] {
    switch (name) {
      case 'codex':
        return [...this.harnessArgs, ...this.codexArgs];
      case 'opencode':
        return [...this.harnessArgs, ...this.opencodeArgs];
      case 'agy':
        return [...this.harnessArgs, ...this.agyArgs];
      case 'fugue-cc':
        return this.harnessArgs;
    }
  }

  private harnessFor(name: HarnessName, timeoutMs: number | undefined): Harness {
    const runner = new NodeCommandRunner();
    const args = this.argsFor(name);
    switch (name) {
      case 'fugue-cc':
        return new FugueCcHarness(runner, {
          bin: this.bin,
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          ...(args.length > 0 ? { args } : {}),
        });
      case 'codex':
        return new CodexHarness(runner, {
          bin: process.env.FUGUE_CODEX ?? 'codex',
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          ...(args.length > 0 ? { args } : {}),
        });
      case 'opencode':
        return new OpencodeHarness(runner, {
          bin: process.env.FUGUE_OPENCODE ?? 'opencode',
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          ...(args.length > 0 ? { args } : {}),
        });
      case 'agy':
        return new AgyHarness(runner, {
          bin: process.env.FUGUE_AGY ?? 'agy',
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          ...(args.length > 0 ? { args } : {}),
        });
    }
  }
}
