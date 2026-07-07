import type { RoundSnapshot } from './logic/round';
import type { AgentInfo, RunResult } from './logic/types';

interface FugueApi {
  run(cmd: string): Promise<RunResult>;
  agents(): Promise<AgentInfo[]>;
  listRounds(): Promise<string[]>;
  round(round: string): Promise<RoundSnapshot>;
}

declare global {
  interface Window {
    fugue: FugueApi;
  }
}

export const bridge: FugueApi = window.fugue;
