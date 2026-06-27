import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { NodeFileSystem } from './node-file-system.js';

describe('NodeFileSystem', () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('implements read, write, mtime, remove, and list against a real temp dir', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'fugue-engine-'));
    tempDirs.push(tempDir);
    const fs = new NodeFileSystem();
    const dir = join(tempDir, 'nested');
    const file = join(dir, 'artifact.txt');

    await fs.write(file, 'hello');

    expect(await fs.read(file)).toBe('hello');
    expect((await fs.list(dir)).some((name) => name.endsWith('.tmp'))).toBe(false);
    expect(await fs.read(join(dir, 'missing.txt'))).toBeNull();
    expect(await fs.mtime(file)).not.toBeNull();
    expect(await fs.list(dir)).toEqual(['artifact.txt']);

    await fs.remove(file);
    await fs.remove(file);

    expect(await fs.read(file)).toBeNull();
  });

  it('treats a file used as a directory as an empty listing', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'fugue-engine-'));
    tempDirs.push(tempDir);
    const fs = new NodeFileSystem();
    const file = join(tempDir, 'not-a-dir.txt');

    await fs.write(file, 'hello');

    expect(await fs.list(file)).toEqual([]);
  });
});
