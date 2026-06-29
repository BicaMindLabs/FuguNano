import type {
  DispatchError,
  DispatchRequest,
  DispatchResult,
  HealthStatus,
} from '../../domain/dispatch.js';
import { buildArgv } from '../../domain/invocation-descriptor.js';
import type { InvocationDescriptor } from '../../domain/invocation-descriptor.js';
import type { Harness, HarnessName } from '../../domain/ports/harness.js';
import type { Result } from '../../domain/result.js';
import type { CommandOptions, CommandResult, CommandRunner } from '../../infra/command-runner.js';
import { runDispatch, type HarnessExecOptions } from './exec-helpers.js';

export const CODEX_INVOCATION_DESCRIPTOR = {
  bin: 'codex',
  subcommand: ['exec'],
  promptMode: 'positional',
  modelArg: '--model',
  healthCmd: ['--version'],
  failureMode: 'exit-code',
} as const satisfies InvocationDescriptor;

export const QWEN_CODE_INVOCATION_DESCRIPTOR = {
  bin: 'qwen',
  promptMode: 'flag',
  flagName: '-p',
  modelArg: 'omit-when-default',
  healthCmd: ['--version'],
  failureMode: 'exit-code',
} as const satisfies InvocationDescriptor;

const ZERO_EXIT_STDERR_ERROR =
  /(?:^|\n).*(?:Error:|ProviderModelNotFoundError|API key is missing)/u;

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const zeroExitStderrError = (result: CommandResult): string | undefined => {
  if (result.stdout.trim().length > 0) return undefined;
  const detail = result.stderr.trim();
  if (detail.length === 0) return undefined;
  return ZERO_EXIT_STDERR_ERROR.test(detail) ? detail : undefined;
};

const commandOptions = (options: HarnessExecOptions): CommandOptions => ({
  ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
  ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
});

/** Generic harness for descriptor-shaped agent CLIs such as Qwen Code. */
export class AgentCliHarness implements Harness {
  readonly name: HarnessName;
  private readonly bin: string;
  private readonly commandOptions: CommandOptions;
  private readonly extraArgs: readonly string[];

  constructor(
    private readonly runner: CommandRunner,
    private readonly descriptor: InvocationDescriptor,
    options: HarnessExecOptions = {},
    name: HarnessName = 'agent-cli',
  ) {
    const bin = options.bin ?? descriptor.bin;
    if (bin === undefined || bin.trim().length === 0) {
      throw new Error('AgentCliHarness requires a descriptor bin or options.bin');
    }
    this.name = name;
    this.bin = bin;
    this.extraArgs = options.args ?? [];
    this.commandOptions = commandOptions(options);
  }

  private options(request: DispatchRequest): CommandOptions {
    return this.descriptor.promptMode === 'stdin'
      ? { stdin: `${request.prompt}\n`, ...this.commandOptions }
      : this.commandOptions;
  }

  dispatch(request: DispatchRequest): Promise<Result<DispatchResult, DispatchError>> {
    return runDispatch(
      this.runner,
      this.bin,
      buildArgv(this.descriptor, request, { extraArgs: this.extraArgs }),
      request,
      this.options(request),
      this.descriptor.failureMode === 'zero-exit-stderr'
        ? { zeroExitError: zeroExitStderrError }
        : {},
    );
  }

  async health(): Promise<HealthStatus> {
    try {
      const result = await this.runner.run(
        this.bin,
        this.descriptor.healthCmd,
        this.commandOptions,
      );
      return result.code === 0
        ? { healthy: true, detail: `${this.bin} ${result.stdout.trim()}`.trim() }
        : {
            healthy: false,
            detail: `${this.bin} ${this.descriptor.healthCmd.join(' ')} exited ${String(
              result.code,
            )}`,
          };
    } catch (error) {
      return { healthy: false, detail: message(error) };
    }
  }
}
