import type {
  DispatchError,
  DispatchRequest,
  DispatchResult,
  HealthStatus,
} from '../../domain/dispatch.js';
import type { Harness } from '../../domain/ports/harness.js';
import type { Result } from '../../domain/result.js';
import type { CommandRunner } from '../../infra/command-runner.js';
import { AgentCliHarness, CODEX_INVOCATION_DESCRIPTOR } from './agent-cli-harness.js';
import type { HarnessExecOptions } from './exec-helpers.js';

/** Dispatch via `codex exec --model <model> <prompt>` (target = model). */
export class CodexHarness implements Harness {
  readonly name = 'codex';
  private readonly delegate: AgentCliHarness;

  constructor(runner: CommandRunner, options: HarnessExecOptions = {}) {
    this.delegate = new AgentCliHarness(runner, CODEX_INVOCATION_DESCRIPTOR, options, this.name);
  }

  dispatch(request: DispatchRequest): Promise<Result<DispatchResult, DispatchError>> {
    return this.delegate.dispatch(request);
  }

  health(): Promise<HealthStatus> {
    return this.delegate.health();
  }
}
