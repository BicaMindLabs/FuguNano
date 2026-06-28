import { join as joinPath } from 'node:path';
import { performance } from 'node:perf_hooks';

import { Command, Option } from 'clipanion';

import { AgyHarness } from '../../adapters/harness/agy-harness.js';
import { CodexHarness } from '../../adapters/harness/codex-harness.js';
import { OpencodeHarness } from '../../adapters/harness/opencode-harness.js';
import type { Harness } from '../../domain/ports/harness.js';
import { isOk } from '../../domain/result.js';
import { NodeCommandRunner } from '../../infra/node-command-runner.js';
import { NodeFileSystem } from '../../infra/node-file-system.js';
import { appendTaskAuditLine } from '../task-audit.js';

const SMOKE_HARNESSES = ['codex', 'opencode', 'agy'] as const;
type SmokeHarnessName = (typeof SMOKE_HARNESSES)[number];

const CODEX_CLEAN_ARGS = [
  '--ignore-user-config',
  '--ignore-rules',
  '--ephemeral',
  '--color',
  'never',
] as const;

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

const isSmokeHarnessName = (value: string): value is SmokeHarnessName =>
  (SMOKE_HARNESSES as readonly string[]).includes(value);

const expectedOutput = (harness: SmokeHarnessName): string => {
  switch (harness) {
    case 'codex':
      return 'FUGUNANO_CODEX_SMOKE_OK';
    case 'opencode':
      return 'FUGUNANO_OPENCODE_SMOKE_OK';
    case 'agy':
      return 'FUGUNANO_AGY_SMOKE_OK';
  }
};

const quoteShort = (value: string): string =>
  JSON.stringify(value.length <= 80 ? value : `${value.slice(0, 77)}...`);

const stripOneFinalLineEnding = (value: string): string => {
  if (value.endsWith('\r\n')) return value.slice(0, -2);
  if (value.endsWith('\n') || value.endsWith('\r')) return value.slice(0, -1);
  return value;
};

interface SmokeResult {
  readonly harness: SmokeHarnessName;
  readonly agent: string;
  readonly ok: boolean;
  readonly elapsedMs: number;
  readonly outputChars: number;
  readonly artifactPath?: string;
  readonly detail?: string;
}

interface SmokeSummaryEntry {
  readonly harness: SmokeHarnessName;
  readonly target: string;
  readonly status: 'ok' | 'failed';
  readonly durationMs: number;
  readonly outputChars: number;
  readonly artifactPath?: string;
  readonly detail?: string;
}

interface SmokeSummary {
  readonly schemaVersion: 1;
  readonly generatedAt: string;
  readonly harnesses: readonly SmokeHarnessName[];
  readonly results: readonly SmokeSummaryEntry[];
}

/** `fugue smoke` — live smoke selected lite runtimes with exact single-line prompts. */
export class SmokeCommand extends Command {
  static override paths = [['smoke']];

  harness = Option.String('--harness', 'all');
  timeoutMs = Option.String('--timeout-ms', process.env.FUGUE_SMOKE_TIMEOUT_MS ?? '120000');
  task = Option.String('--task');
  outDir = Option.String('--out-dir');
  codexTarget = Option.String('--codex-target', process.env.FUGUE_SMOKE_CODEX ?? 'gpt-5.5');
  opencodeTarget = Option.String(
    '--opencode-target',
    process.env.FUGUE_SMOKE_OPENCODE ?? 'opencode/deepseek-v4-flash-free',
  );
  agyTarget = Option.String('--agy-target', process.env.FUGUE_SMOKE_AGY ?? 'default');
  codexBin = Option.String('--codex-bin', process.env.FUGUE_CODEX ?? 'codex');
  opencodeBin = Option.String('--opencode-bin', process.env.FUGUE_OPENCODE ?? 'opencode');
  agyBin = Option.String('--agy-bin', process.env.FUGUE_AGY ?? 'agy');
  codexArgs = Option.Array('--codex-arg', []);
  opencodeArgs = Option.Array('--opencode-arg', []);
  agyArgs = Option.Array('--agy-arg', []);
  codexClean = Option.Boolean('--codex-clean', process.env.FUGUE_CODEX_CLEAN === '1');

  private readonly fs = new NodeFileSystem();

  override async execute(): Promise<number> {
    const selection = this.selectedHarnesses();
    if (selection === null) return 2;
    const timeoutMs = parseTimeoutMs(this.timeoutMs);
    if (timeoutMs === null) {
      this.context.stderr.write(
        `invalid --timeout-ms '${this.timeoutMs}' (expected positive ms)\n`,
      );
      return 2;
    }

    this.context.stdout.write(`── live runtime smoke (${selection.join(', ')}) ──\n`);
    const results = await Promise.all(
      selection.map((harness) => this.runSmoke(harness, timeoutMs)),
    );
    for (const result of results) {
      this.context.stdout.write(`${this.formatResult(result)}\n`);
    }
    const passed = results.filter((result) => result.ok).length;
    const failed = results.length - passed;
    const summaryPath = await this.writeSummary(selection, results);
    if (summaryPath !== undefined) {
      this.context.stdout.write(`  → smoke summary written to ${summaryPath}\n`);
    }
    this.context.stdout.write(
      failed === 0
        ? `✓ smoke GO (${String(passed)}/${String(results.length)})\n`
        : `✗ smoke NO-GO (${String(failed)}/${String(results.length)} failed)\n`,
    );
    return failed === 0 ? 0 : 1;
  }

  private selectedHarnesses(): readonly SmokeHarnessName[] | null {
    if (this.harness === 'all') return SMOKE_HARNESSES;
    if (isSmokeHarnessName(this.harness)) return [this.harness];
    this.context.stderr.write(
      `unknown smoke harness '${this.harness}' (all|${SMOKE_HARNESSES.join('|')})\n`,
    );
    return null;
  }

  private agentFor(harness: SmokeHarnessName): string {
    switch (harness) {
      case 'codex':
        return this.codexTarget;
      case 'opencode':
        return this.opencodeTarget;
      case 'agy':
        return this.agyTarget;
    }
  }

  private harnessFor(harness: SmokeHarnessName, timeoutMs: number | undefined): Harness {
    const runner = new NodeCommandRunner();
    switch (harness) {
      case 'codex': {
        const args = this.codexClean ? [...CODEX_CLEAN_ARGS, ...this.codexArgs] : this.codexArgs;
        return new CodexHarness(runner, {
          bin: this.codexBin,
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          ...(args.length > 0 ? { args } : {}),
        });
      }
      case 'opencode':
        return new OpencodeHarness(runner, {
          bin: this.opencodeBin,
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          ...(this.opencodeArgs.length > 0 ? { args: this.opencodeArgs } : {}),
        });
      case 'agy':
        return new AgyHarness(runner, {
          bin: this.agyBin,
          ...(timeoutMs !== undefined ? { timeoutMs } : {}),
          ...(this.agyArgs.length > 0 ? { args: this.agyArgs } : {}),
        });
    }
  }

  private async runSmoke(
    harness: SmokeHarnessName,
    timeoutMs: number | undefined,
  ): Promise<SmokeResult> {
    const agent = this.agentFor(harness);
    const expected = expectedOutput(harness);
    const outputPath =
      this.outDir === undefined ? undefined : joinPath(this.outDir, `${harness}.txt`);
    await this.appendTaskLine(
      `smoke → ${harness} [${agent}] (status=started${
        outputPath === undefined ? '' : ` out=${outputPath}`
      })`,
    );

    const startedAt = performance.now();
    const result = await this.harnessFor(harness, timeoutMs).dispatch({
      agent,
      prompt: `Return exactly: ${expected}`,
      taskType: 'runtime-smoke',
    });
    const elapsedMs = performance.now() - startedAt;

    if (!isOk(result)) {
      if (outputPath !== undefined) await this.fs.write(outputPath, result.error.detail);
      await this.appendTaskLine(
        `smoke → ${harness} [${agent}] (status=failed rc=${String(
          result.error.exitCode ?? 1,
        )} error=${result.error.kind} took=${formatDurationMs(elapsedMs)} output_chars=0${
          outputPath === undefined ? '' : ` out=${outputPath}`
        })`,
      );
      return {
        harness,
        agent,
        ok: false,
        elapsedMs,
        outputChars: 0,
        ...(outputPath === undefined ? {} : { artifactPath: outputPath }),
        detail: result.error.detail,
      };
    }

    const output = result.value.output;
    if (outputPath !== undefined) await this.fs.write(outputPath, output);
    const exact = stripOneFinalLineEnding(output) === expected;
    await this.appendTaskLine(
      `smoke → ${harness} [${agent}] (status=${exact ? 'ok' : 'failed'} rc=${
        exact ? '0' : '1'
      }${exact ? '' : ' error=output-mismatch'} took=${formatDurationMs(
        elapsedMs,
      )} output_chars=${String(output.length)}${
        outputPath === undefined ? '' : ` out=${outputPath}`
      })`,
    );
    return {
      harness,
      agent,
      ok: exact,
      elapsedMs,
      outputChars: output.length,
      ...(outputPath === undefined ? {} : { artifactPath: outputPath }),
      ...(exact ? {} : { detail: `expected ${expected}, got ${quoteShort(output)}` }),
    };
  }

  private async writeSummary(
    selection: readonly SmokeHarnessName[],
    results: readonly SmokeResult[],
  ): Promise<string | undefined> {
    if (this.outDir === undefined) return undefined;
    const summaryPath = joinPath(this.outDir, 'summary.json');
    const summary: SmokeSummary = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      harnesses: selection,
      results: results.map(
        (result): SmokeSummaryEntry => ({
          harness: result.harness,
          target: result.agent,
          status: result.ok ? 'ok' : 'failed',
          durationMs: Math.round(result.elapsedMs),
          outputChars: result.outputChars,
          ...(result.artifactPath === undefined ? {} : { artifactPath: result.artifactPath }),
          ...(result.detail === undefined ? {} : { detail: result.detail }),
        }),
      ),
    };
    await this.fs.write(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
    return summaryPath;
  }

  private formatResult(result: SmokeResult): string {
    const base = `${result.harness} ${result.agent} (${formatDurationMs(
      result.elapsedMs,
    )}, ${String(result.outputChars)} chars)`;
    return result.ok ? `  ✓ ${base}` : `  ✗ ${base}: ${result.detail ?? 'failed'}`;
  }

  private async appendTaskLine(message: string): Promise<void> {
    if (this.task !== undefined) await appendTaskAuditLine(this.fs, this.task, message);
  }
}
