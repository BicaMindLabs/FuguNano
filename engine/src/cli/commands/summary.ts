import { join as joinPath } from 'node:path';

import { Command, Option } from 'clipanion';

import { NodeFileSystem } from '../../infra/node-file-system.js';
import { defaultCacheRoot } from '../default-paths.js';

interface SummaryRow {
  readonly id: string;
  readonly agent: string;
  readonly status: string;
}

interface SummarySnapshot {
  readonly round: string;
  readonly statusLine: string;
  readonly elapsed: string;
  readonly rows: readonly SummaryRow[];
}

const fs = (): NodeFileSystem => new NodeFileSystem();

const parseManifest = (content: string): readonly Omit<SummaryRow, 'status'>[] => {
  const rows: Omit<SummaryRow, 'status'>[] = [];
  for (const raw of content.split(/\r?\n/u)) {
    if (raw.length === 0) continue;
    const tab = raw.indexOf('\t');
    rows.push({
      id: tab === -1 ? raw : raw.slice(0, tab),
      agent: tab === -1 ? '' : raw.slice(tab + 1),
    });
  }
  return rows;
};

const elapsedSince = (started: string | null): string => {
  if (started === null) return '?';
  const startedSeconds = Number.parseInt(started.trim(), 10);
  if (!Number.isFinite(startedSeconds)) return '?';
  return `${String(Math.max(0, Math.floor(Date.now() / 1000) - startedSeconds))}s`;
};

const loadSummary = async (cache: string, round: string): Promise<SummarySnapshot | null> => {
  const fileSystem = fs();
  const dir = joinPath(cache, `round-${round}`);
  const manifest = await fileSystem.read(joinPath(dir, 'manifest.tsv'));
  if (manifest === null) return null;
  let done = 0;
  let fail = 0;
  const rows: SummaryRow[] = [];
  for (const row of parseManifest(manifest)) {
    const status = (await fileSystem.read(joinPath(dir, `${row.id}.status`)))?.trim() ?? 'pending';
    if (status === 'done') done += 1;
    if (status === 'fail') fail += 1;
    rows.push({ ...row, status });
  }
  const total = rows.length;
  const pending = total - done - fail;
  return {
    round,
    statusLine: `round-${round}: total=${String(total)} done=${String(done)} fail=${String(fail)} pending=${String(pending)}`,
    elapsed: elapsedSince(await fileSystem.read(joinPath(dir, '.started'))),
    rows,
  };
};

const renderSnapshot = (snapshot: SummarySnapshot): string =>
  [
    `### Round ${snapshot.round} summary — ${snapshot.statusLine} — elapsed ${snapshot.elapsed}`,
    ...snapshot.rows.map((row) => `  ${row.id.padEnd(22)} ${row.agent.padEnd(14)} ${row.status}`),
  ].join('\n');

export class SummaryCommand extends Command {
  static override paths = [['summary']];

  round = Option.String();
  cache = Option.String('--cache');
  task = Option.String('--task');

  override async execute(): Promise<number> {
    const snapshot = await loadSummary(this.cache ?? defaultCacheRoot(import.meta.url), this.round);
    if (snapshot === null) {
      this.context.stderr.write(`round-${this.round} not init\n`);
      return 2;
    }
    const summary = renderSnapshot(snapshot);
    this.context.stdout.write(`${summary}\n`);

    if (this.task !== undefined) {
      const fileSystem = fs();
      const content = await fileSystem.read(this.task);
      if (content === null) {
        this.context.stderr.write(`no TASK file ${this.task}\n`);
        return 2;
      }
      await fileSystem.append(this.task, `\n${summary}\n`);
      this.context.stderr.write(`→ written to ${this.task}\n`);
    }
    return 0;
  }
}
