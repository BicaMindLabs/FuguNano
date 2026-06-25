import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { wireCoordinator } from './wire.js';

describe('wireCoordinator', () => {
  it('defaults to the fugue-cc harness', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fugue-wire-'));
    const binDir = join(dir, 'bin');
    const calls = join(dir, 'calls.txt');
    const prompt = join(dir, 'prompt.txt');
    const fugueCc = join(binDir, 'fugue-cc');
    const oldPath = process.env.PATH;
    const oldCalls = process.env.FUGUE_WIRE_CALLS;
    const oldPrompt = process.env.FUGUE_WIRE_PROMPT;

    try {
      await mkdir(binDir);
      await writeFile(
        fugueCc,
        [
          '#!/bin/sh',
          'printf "%s\\n" "$*" > "$FUGUE_WIRE_CALLS"',
          'cat > "$FUGUE_WIRE_PROMPT"',
          'printf "stub output\\n"',
          '',
        ].join('\n'),
      );
      await chmod(fugueCc, 0o755);

      process.env.PATH = `${binDir}${delimiter}${oldPath ?? ''}`;
      process.env.FUGUE_WIRE_CALLS = calls;
      process.env.FUGUE_WIRE_PROMPT = prompt;

      const coordinator = wireCoordinator({ stateDir: join(dir, 'state') });
      const report = await coordinator.dispatchRound('run-1', 1, [
        { key: 't1', taskType: 'code', prompt: 'build it', agent: 'cc-deepseek' },
      ]);

      expect(report.status).toBe('completed');
      expect(await readFile(calls, 'utf8')).toBe('ask cc-deepseek --compact\n');
      expect(await readFile(prompt, 'utf8')).toBe('build it\n');
    } finally {
      if (oldPath === undefined) delete process.env.PATH;
      else process.env.PATH = oldPath;
      if (oldCalls === undefined) delete process.env.FUGUE_WIRE_CALLS;
      else process.env.FUGUE_WIRE_CALLS = oldCalls;
      if (oldPrompt === undefined) delete process.env.FUGUE_WIRE_PROMPT;
      else process.env.FUGUE_WIRE_PROMPT = oldPrompt;
      await rm(dir, { recursive: true, force: true });
    }
  });
});
