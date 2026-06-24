import { Command, Option, UsageError } from 'clipanion';

import { FsTaskStore } from '../../adapters/task/fs-task-store.js';
import type { TaskPriority } from '../../domain/task-file.js';
import { systemClock } from '../../infra/clock.js';
import { NodeFileSystem } from '../../infra/node-file-system.js';
import { tasksDir } from '../state-dir.js';

const store = (): FsTaskStore => new FsTaskStore(new NodeFileSystem(), systemClock, tasksDir());

/** Default an absent flag to P1; reject any other non-P0/P1/P2 value loudly. */
const asPriority = (raw: string | undefined): TaskPriority => {
  if (raw === undefined) return 'P1';
  if (raw === 'P0' || raw === 'P1' || raw === 'P2') return raw;
  throw new UsageError(`invalid --priority ${raw} (expected P0, P1, or P2)`);
};

/** `fugue task new <title> [--priority P0|P1|P2]` — create a TASK file, print its path. */
export class TaskNewCommand extends Command {
  static override paths = [['task', 'new']];

  title = Option.String();
  priority = Option.String('--priority', { description: 'P0 | P1 | P2 (default P1)' });

  override async execute(): Promise<void> {
    const ref = await store().create(this.title, asPriority(this.priority));
    this.context.stdout.write(`${ref.path}\n`);
  }
}

/** `fugue task log <path> <message>` — append a timestamped log line to a TASK file. */
export class TaskLogCommand extends Command {
  static override paths = [['task', 'log']];

  file = Option.String();
  message = Option.String();

  override async execute(): Promise<void> {
    await store().log(this.file, this.message);
    this.context.stdout.write(`logged → ${this.file}\n`);
  }
}

/** `fugue task done <path>` — mark a TASK file DONE and stamp its completion time. */
export class TaskDoneCommand extends Command {
  static override paths = [['task', 'done']];

  file = Option.String();

  override async execute(): Promise<void> {
    await store().done(this.file);
    this.context.stdout.write(`done → ${this.file}\n`);
  }
}
