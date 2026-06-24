import { describe, expect, it } from 'vitest';

import { MemoryFileSystem } from '../../infra/memory-file-system.js';
import type { Clock } from '../../infra/clock.js';
import { FsTaskStore } from './fs-task-store.js';

// Fixed instant → deterministic date in the store's timezone.
const clock: Clock = { now: () => 1_718_000_000_000 };
const make = (): FsTaskStore => new FsTaskStore(new MemoryFileSystem(clock), clock, '/tasks');

describe('FsTaskStore', () => {
  it('creates a TASK-<date>-NNN file with the template', async () => {
    const ref = await make().create('build the thing', 'P0');
    expect(ref.id).toMatch(/^TASK-\d{4}-\d{2}-\d{2}-001$/u);
    expect(ref.path).toBe(`/tasks/${ref.id}.md`);
  });

  it('increments the sequence number', async () => {
    const store = make();
    const a = await store.create('one');
    const b = await store.create('two');
    expect(a.id.endsWith('-001')).toBe(true);
    expect(b.id.endsWith('-002')).toBe(true);
  });

  it('appends a timestamped log line', async () => {
    const fs = new MemoryFileSystem(clock);
    const store = new FsTaskStore(fs, clock, '/tasks');
    const ref = await store.create('x');
    await store.log(ref.path, 'did a thing');
    const content = await fs.read(ref.path);
    expect(content).toMatch(/- \[\d{4}-\d{2}-\d{2} \d{2}:\d{2}\] did a thing/u);
  });

  it('marks the task DONE and stamps Completed', async () => {
    const fs = new MemoryFileSystem(clock);
    const store = new FsTaskStore(fs, clock, '/tasks');
    const ref = await store.create('x');
    await store.done(ref.path);
    const content = (await fs.read(ref.path)) ?? '';
    expect(content).toContain('Status: DONE');
    expect(content).not.toContain('Completed: -');
  });
});
