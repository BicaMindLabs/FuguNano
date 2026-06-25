/**
 * Injected subprocess runner — lets harness adapters be tested with a fake
 * (no real fugue-cc/codex/opencode) and keeps `child_process` out of domain/app.
 */
export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface CommandOptions {
  readonly stdin?: string;
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
}

export interface CommandRunner {
  run(command: string, args: readonly string[], options?: CommandOptions): Promise<CommandResult>;
}
