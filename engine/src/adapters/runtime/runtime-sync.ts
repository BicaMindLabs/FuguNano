import { detectDrift, type VersionDrift } from '../../domain/runtime-sync.js';
import type { CommandRunner } from '../../infra/command-runner.js';
import type { FileSystem } from '../../infra/file-system.js';

export interface RuntimeSyncOptions {
  readonly bin?: string;
  /** Where the last-seen version is recorded. */
  readonly stampPath: string;
}

export const parseProviderVersion = (output: string): string =>
  output.match(/v[0-9]+\.[0-9]+\.[0-9]+/u)?.[0] ?? output.trim();

export const parseProviderInstallPath = (output: string): string | null => {
  const match = /^Install path:\s*(.+)$/mu.exec(output);
  return match?.[1]?.trim() ?? null;
};

/** Detects + records provider version drift for the fugue-cc runtime. */
export class RuntimeSync {
  private readonly bin: string;
  private readonly stampPath: string;

  constructor(
    private readonly fs: FileSystem,
    private readonly runner: CommandRunner,
    options: RuntimeSyncOptions,
  ) {
    this.bin = options.bin ?? 'fugue-cc';
    this.stampPath = options.stampPath;
  }

  async currentVersion(): Promise<string> {
    try {
      const result = await this.runner.run(this.bin, ['version']);
      if (result.code !== 0) return '';
      return parseProviderVersion(result.stdout);
    } catch {
      return '';
    }
  }

  async check(): Promise<VersionDrift> {
    const current = await this.currentVersion();
    const last = (await this.fs.read(this.stampPath))?.trim() ?? null;
    if (current.length === 0) return { current: last ?? '', last, drifted: false };
    return detectDrift(current, last);
  }

  /** Record the current version as the new baseline (call after a successful adapt). */
  async record(version: string): Promise<void> {
    await this.fs.write(this.stampPath, `${version}\n`);
  }
}
