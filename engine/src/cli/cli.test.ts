import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { Cli } from 'clipanion';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildCli } from './cli.js';

const collector = (): { stream: Writable; text: () => string } => {
  let buf = '';
  const stream = new Writable({
    write(chunk: Buffer, _enc: BufferEncoding, cb: (error?: Error | null) => void): void {
      buf += chunk.toString();
      cb();
    },
  });
  return { stream, text: () => buf };
};

const run = async (
  argv: readonly string[],
): Promise<{ code: number; out: string; err: string }> => {
  const out = collector();
  const err = collector();
  const code = await buildCli().run([...argv], {
    ...Cli.defaultContext,
    stdout: out.stream,
    stderr: err.stream,
  });
  return { code, out: out.text(), err: err.text() };
};

describe('fugue CLI', () => {
  it('prints the version', async () => {
    const { code, out } = await run(['version']);
    expect(code).toBe(0);
    expect(out).toContain('0.0.0');
  });

  it('errors with exit 1 on a missing goal spec', async () => {
    const { code, err } = await run(['goal', 'check', '/no/such/spec.txt']);
    expect(code).toBe(1);
    expect(err).toContain('no goal spec');
  });

  describe('goal check against a real spec', () => {
    let dir: string;
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'fugue-cli-'));
    });
    afterEach(async () => {
      await rm(dir, { recursive: true, force: true });
    });

    it('reports GOAL MET when the gate command exits 0', async () => {
      const spec = join(dir, 'goal.txt');
      await writeFile(spec, 'outcome: ship it\ngate: true\nrounds: 1\n', 'utf8');
      const { code, out } = await run(['goal', 'check', spec]);
      expect(code).toBe(0);
      expect(out).toContain('GOAL MET');
    });

    it('reports GOAL NOT MET when the gate command fails', async () => {
      const spec = join(dir, 'goal.txt');
      await writeFile(spec, 'outcome: ship it\ngate: false\nrounds: 1\n', 'utf8');
      const { code, out } = await run(['goal', 'check', spec]);
      expect(code).toBe(1);
      expect(out).toContain('GOAL NOT MET');
    });

    it('never reports MET for a spec with no gate command', async () => {
      const spec = join(dir, 'goal.txt');
      await writeFile(spec, 'outcome: ship it\nrounds: 1\n', 'utf8');
      const { code, out } = await run(['goal', 'check', spec]);
      expect(code).toBe(1);
      expect(out).toContain('GOAL NOT MET');
    });
  });

  describe('task new --priority validation', () => {
    let dir: string;
    beforeEach(async () => {
      dir = await mkdtemp(join(tmpdir(), 'fugue-task-'));
      process.env.TASKS = dir;
    });
    afterEach(async () => {
      delete process.env.TASKS;
      await rm(dir, { recursive: true, force: true });
    });

    it('rejects an invalid --priority instead of silently defaulting', async () => {
      // clipanion renders a thrown UsageError to stdout as "Usage Error: ..."
      const { code, out } = await run(['task', 'new', 'a task', '--priority', 'P9']);
      expect(code).not.toBe(0);
      expect(out).toContain('invalid --priority');
    });

    it('accepts P0 and writes the TASK file', async () => {
      const { code, out } = await run(['task', 'new', 'a task', '--priority', 'P0']);
      expect(code).toBe(0);
      expect(out).toContain('TASK-');
    });
  });
});
