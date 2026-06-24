import type { TaskPriority, TaskRef } from '../task-file.js';

/** Scaffolds + maintains TASK files (the fan-out audit trail). */
export interface TaskStore {
  /** Create `TASK-<date>-<NNN>.md`, returning its id + path. */
  create(title: string, priority?: TaskPriority): Promise<TaskRef>;
  /** Append a timestamped line to the task's log. */
  log(path: string, message: string): Promise<void>;
  /** Mark the task DONE and stamp Completed. */
  done(path: string): Promise<void>;
}
