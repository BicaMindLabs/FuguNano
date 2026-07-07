// Cache fan-out round snapshot — mirrors what the main process reads off disk (round-<n>/).

export interface RoundTask {
  readonly id: string;
  readonly agent: string;
  readonly status: string; // 'done' | 'fail' | 'pending'
  readonly at: string | null;
  readonly bytes: number;
  readonly preview: string | null;
}

export interface RoundTotals {
  readonly total: number;
  readonly done: number;
  readonly fail: number;
  readonly pending: number;
}

export interface RoundSnapshot {
  readonly round: string;
  readonly error: string | null;
  readonly tasks: readonly RoundTask[];
  readonly totals: RoundTotals | null;
}

export const statusColor = (status: string): string =>
  status === 'done'
    ? 'var(--green-700)'
    : status === 'fail'
      ? 'var(--red-800)'
      : 'var(--gray-700)';
