import { describe, expect, it } from 'vitest';

import { isErr, isOk } from '../../domain/result.js';
import type { CommandResult, CommandRunner } from '../../infra/command-runner.js';
import { GitVcsPort } from './git-vcs.js';

const ID = { name: 'fuguectl', email: 'fuguectl@local' };

class ScriptRunner implements CommandRunner {
  readonly calls: string[][] = [];
  constructor(private readonly handler: (args: readonly string[]) => Partial<CommandResult>) {}
  run(_command: string, args: readonly string[]): Promise<CommandResult> {
    this.calls.push([...args]);
    return Promise.resolve({ code: 0, stdout: '', stderr: '', ...this.handler(args) });
  }
}

describe('GitVcsPort', () => {
  it('parses `status --porcelain`, including untracked and renames', async () => {
    const runner = new ScriptRunner(() => ({
      stdout: ' M src/a.ts\n?? new.txt\nR  old.ts -> renamed.ts\n',
    }));
    expect(await new GitVcsPort(runner).changedFiles('/wt')).toEqual([
      'src/a.ts',
      'new.txt',
      'renamed.ts',
    ]);
  });

  it('commitAll returns no-commit when nothing is staged', async () => {
    // `diff --cached --quiet` exit 0 = no staged changes
    const runner = new ScriptRunner((a) => (a.includes('diff') ? { code: 0 } : {}));
    const result = await new GitVcsPort(runner).commitAll('/wt', ID, 'msg');
    expect(isErr(result) && result.error.kind).toBe('no-commit');
  });

  it('commitAll commits as the identity and returns the new sha', async () => {
    const runner = new ScriptRunner((a) => {
      if (a.includes('diff')) return { code: 1 }; // staged changes present
      if (a.includes('rev-parse')) return { stdout: 'abc123\n' };
      return { code: 0 };
    });
    const result = await new GitVcsPort(runner).commitAll('/wt', ID, 'msg');
    expect(isOk(result) && result.value).toBe('abc123');
    const commit = runner.calls.find((c) => c.includes('commit'));
    expect(commit).toContain('user.name=fuguectl');
    expect(commit).toContain('user.email=fuguectl@local');
  });

  it('cherryPick aborts and reports a conflict on nonzero', async () => {
    const runner = new ScriptRunner((a) =>
      a.includes('--abort') ? { code: 0 } : { code: 1, stderr: 'conflict' },
    );
    const result = await new GitVcsPort(runner).cherryPick('/repo', 'sha', ID);
    expect(isErr(result) && result.error.kind).toBe('conflict');
    expect(runner.calls.some((c) => c.includes('cherry-pick') && c.includes('--abort'))).toBe(true);
  });

  it('cherryPick succeeds on exit 0', async () => {
    const runner = new ScriptRunner(() => ({ code: 0 }));
    expect(isOk(await new GitVcsPort(runner).cherryPick('/repo', 'sha', ID))).toBe(true);
  });
});
