import { homedir } from 'node:os';

import { joinPath } from '../adapters/store/paths.js';

/** Engine durable-state root (allocation/barrier/results/runs). Override via FUGUNANO_STATE. */
export const stateDir = (): string =>
  process.env.FUGUNANO_STATE ??
  process.env.FUGUE_STATE ??
  joinPath(joinPath(homedir(), '.config'), 'fugunano');

/** TASK files directory. Override via TASKS. */
export const tasksDir = (): string =>
  process.env.TASKS ?? joinPath(joinPath(homedir(), '.claude'), 'tasks');
