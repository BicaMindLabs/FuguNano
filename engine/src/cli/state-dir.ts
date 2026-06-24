import { homedir } from 'node:os';

import { joinPath } from '../adapters/store/paths.js';

/** Engine durable-state root (allocation/barrier/results/runs). Override via FUGUE_STATE. */
export const stateDir = (): string =>
  process.env.FUGUE_STATE ?? joinPath(joinPath(homedir(), '.config'), 'fugue');

/** TASK files directory. Override via TASKS. */
export const tasksDir = (): string =>
  process.env.TASKS ?? joinPath(joinPath(homedir(), '.claude'), 'tasks');
