import type { TaskStore } from '../../domain/ports/task-store.js';
import type { TaskPriority, TaskRef } from '../../domain/task-file.js';
import { renderTaskFile } from '../../domain/task-file.js';
import type { Clock } from '../../infra/clock.js';
import type { FileSystem } from '../../infra/file-system.js';
import { withFileLock } from '../../infra/file-lock.js';
import { joinPath } from '../store/paths.js';

const pad3 = (n: number): string => String(n).padStart(3, '0');

/** Filesystem-backed TASK files under a directory, dates in a configurable timezone. */
export class FsTaskStore implements TaskStore {
  constructor(
    private readonly fs: FileSystem,
    private readonly clock: Clock,
    private readonly dir: string,
    private readonly timeZone = 'Asia/Shanghai',
  ) {}

  async create(title: string, priority: TaskPriority = 'P1'): Promise<TaskRef> {
    const day = this.day();
    for (let n = 1; n <= 999; n += 1) {
      const id = `TASK-${day}-${pad3(n)}`;
      const path = joinPath(this.dir, `${id}.md`);
      if (await this.fs.writeNew(path, renderTaskFile(id, title, priority, this.stamp()))) {
        return { id, path };
      }
    }
    throw new Error(`no free TASK id for ${day} (001-999 taken)`);
  }

  async log(path: string, message: string): Promise<void> {
    await this.withTaskLock(path, async () => {
      const content = await this.read(path);
      const line = `- [${this.stamp()}] ${message}`;
      await this.fs.append(path, `${content.endsWith('\n') ? '' : '\n'}${line}\n`);
    });
  }

  async done(path: string): Promise<void> {
    await this.withTaskLock(path, async () => {
      const content = await this.read(path);
      const next = content
        .replace(/^Status:.*$/mu, 'Status: DONE')
        .replace(/^Completed:.*$/mu, `Completed: ${this.stamp()}`);
      await this.fs.write(path, next);
    });
  }

  private async withTaskLock<T>(path: string, action: () => Promise<T>): Promise<T> {
    return withFileLock(this.fs, `${path}.lock`, this.stamp(), action);
  }

  private async read(path: string): Promise<string> {
    const content = await this.fs.read(path);
    if (content === null) throw new Error(`no task file ${path}`);
    return content;
  }

  private parts(): { day: string; time: string } {
    const date = new Date(this.clock.now());
    const day = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
    const time = new Intl.DateTimeFormat('en-GB', {
      timeZone: this.timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(date);
    return { day, time };
  }

  private day(): string {
    return this.parts().day;
  }

  private stamp(): string {
    const { day, time } = this.parts();
    return `${day} ${time}`;
  }
}
