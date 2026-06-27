import { describe, expect, it } from 'vitest';

import { detectDrift } from '../../domain/runtime-sync.js';
import { systemClock } from '../../infra/clock.js';
import type { CommandResult, CommandRunner } from '../../infra/command-runner.js';
import { MemoryFileSystem } from '../../infra/memory-file-system.js';
import { RuntimeSync } from './runtime-sync.js';

class VersionRunner implements CommandRunner {
  constructor(private readonly version: string) {}
  run(): Promise<CommandResult> {
    return Promise.resolve({ code: 0, stdout: this.version, stderr: '' });
  }
}

describe('detectDrift', () => {
  it('drifts only when a recorded version differs from current', () => {
    expect(detectDrift('2.0', null).drifted).toBe(false);
    expect(detectDrift('2.0', '2.0').drifted).toBe(false);
    expect(detectDrift('2.1', '2.0').drifted).toBe(true);
  });
});

describe('RuntimeSync', () => {
  it('compares the provider version against the recorded stamp and can re-record', async () => {
    const fs = new MemoryFileSystem(systemClock);
    await fs.write('/state/runtime-version', '2.0\n');
    const sync = new RuntimeSync(fs, new VersionRunner('2.1\n'), {
      stampPath: '/state/runtime-version',
    });

    expect(await sync.check()).toEqual({ current: '2.1', last: '2.0', drifted: true });

    await sync.record('2.1');
    expect((await fs.read('/state/runtime-version'))?.trim()).toBe('2.1');
  });

  it('does not drift without a recorded baseline', async () => {
    const sync = new RuntimeSync(new MemoryFileSystem(systemClock), new VersionRunner('3.0\n'), {
      stampPath: '/state/runtime',
    });

    expect(await sync.check()).toEqual({ current: '3.0', last: null, drifted: false });
  });

  it('keeps the recorded baseline when the current version is unavailable', async () => {
    const fs = new MemoryFileSystem(systemClock);
    await fs.write('/state/runtime-version', '2.0\n');
    const sync = new RuntimeSync(fs, new VersionRunner(''), {
      stampPath: '/state/runtime-version',
    });

    expect(await sync.check()).toEqual({ current: '2.0', last: '2.0', drifted: false });
  });
});
