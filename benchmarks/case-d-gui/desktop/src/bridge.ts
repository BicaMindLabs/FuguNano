import type { RoundSnapshot } from './logic/round';
import type { AgentInfo, RunResult } from './logic/types';

interface ReadJsonResult {
  readonly error: string | null;
  readonly data?: unknown;
}

interface FugueApi {
  run(cmd: string): Promise<RunResult>;
  agents(): Promise<AgentInfo[]>;
  listRounds(): Promise<string[]>;
  round(round: string): Promise<RoundSnapshot>;
  readJson(path: string): Promise<ReadJsonResult>;
}

declare global {
  interface Window {
    fugue: FugueApi;
  }
}

export const bridge: FugueApi = window.fugue;
