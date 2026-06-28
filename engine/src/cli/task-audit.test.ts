import { describe, expect, it } from 'vitest';

import { FsTaskStore } from '../adapters/task/fs-task-store.js';
import type { Clock } from '../infra/clock.js';
import type { FileSystem } from '../infra/file-system.js';
import { MemoryFileSystem } from '../infra/memory-file-system.js';
import { appendTaskAuditLine } from './task-audit.js';

const clock: Clock = { now: () => 1_718_000_000_000 };

const deferred = (): { readonly promise: Promise<void>; readonly resolve: () => void } => {
  let resolveFn: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolveFn = resolve;
  });

  return {
    promise,
    resolve: () => {
      if (resolveFn === undefined) throw new Error('deferred not initialized');
      resolveFn();
    },
  };
};

class BlockingDoneWriteFileSystem implements FileSystem {
  private readonly inner = new MemoryFileSystem(clock);

  constructor(
    private readonly doneWriteStarted: () => void,
    private readonly releaseDoneWrite: Promise<void>,
  ) {}

  read(path: string): Promise<string | null> {
    return this.inner.read(path);
  }

  writeNew(path: string, content: string): Promise<boolean> {
    return this.inner.writeNew(path, content);
  }

  async write(path: string, content: string): Promise<void> {
    if (content.includes('Status: DONE')) {
      this.doneWriteStarted();
      await this.releaseDoneWrite;
    }
    await this.inner.write(path, content);
  }

  append(path: string, content: string): Promise<void> {
    return this.inner.append(path, content);
  }

  mtime(path: string): Promise<number | null> {
    return this.inner.mtime(path);
  }

  remove(path: string): Promise<void> {
    return this.inner.remove(path);
  }

  list(dir: string): Promise<readonly string[]> {
    return this.inner.list(dir);
  }
}

describe('task audit locking', () => {
  it('serializes CLI audit appends with task closeout', async () => {
    const doneWriteStarted = deferred();
    const releaseDoneWrite = deferred();
    const fs = new BlockingDoneWriteFileSystem(doneWriteStarted.resolve, releaseDoneWrite.promise);
    const store = new FsTaskStore(fs, clock, '/tasks');
    const ref = await store.create('x');

    const done = store.done(ref.path);
    await doneWriteStarted.promise;

    const audit = appendTaskAuditLine(fs, ref.path, 'dispatch audit survived');
    await Promise.resolve();
    releaseDoneWrite.resolve();
    await Promise.all([done, audit]);

    const content = (await fs.read(ref.path)) ?? '';
    expect(content).toContain('Status: DONE');
    expect(content).toContain('dispatch audit survived');
  });

  it('does not create missing TASK files while auditing', async () => {
    const fs = new MemoryFileSystem(clock);

    await expect(appendTaskAuditLine(fs, '/tasks/missing.md', 'note')).resolves.toBe(false);

    await expect(fs.read('/tasks/missing.md')).resolves.toBeNull();
    await expect(fs.read('/tasks/missing.md.lock')).resolves.toBeNull();
  });
});
