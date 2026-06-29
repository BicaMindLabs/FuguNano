import { Command, Option } from 'clipanion';

import {
  DEFAULT_ALLOCATION_PARAMS,
  type AllocationOutcome,
  type AllocationParams,
  type BenchTable,
  type Ranking,
  type StrategyState,
} from '../../domain/allocation.js';
import { applyOutcome, decayState, rankAgents } from '../../domain/allocation-score.js';
import { NodeFileSystem } from '../../infra/node-file-system.js';
import { seededRng } from '../../infra/seeded-rng.js';
import { systemRng, type Rng } from '../../infra/rng.js';
import {
  defaultAllocationLedger,
  defaultAllocationStats,
  defaultAllocationTable,
} from '../default-paths.js';
import { splitCsv } from '../param-parse.js';

interface ParsedArgs {
  readonly ok: true;
  readonly paths: AllocationPaths;
  readonly params: AllocationParams;
  readonly rest: readonly string[];
}

interface ParseError {
  readonly ok: false;
  readonly message: string;
}

interface AllocationPaths {
  readonly table: string;
  readonly stats: string;
  readonly ledger: string;
}

type ParseResult = ParsedArgs | ParseError;

const defaultPaths = (): AllocationPaths => ({
  table: defaultAllocationTable(import.meta.url),
  stats: defaultAllocationStats(),
  ledger: defaultAllocationLedger(),
});

const defaultParams = (): AllocationParams => ({
  kappa: Number.parseFloat(
    process.env.FUGUE_ALLOCATE_KAPPA ?? String(DEFAULT_ALLOCATION_PARAMS.kappa),
  ),
  unlistedPrior: DEFAULT_ALLOCATION_PARAMS.unlistedPrior,
});

const parseFiniteNumber = (raw: string): number | null => {
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
};

const parseArgs = (args: readonly string[]): ParseResult => {
  let paths = defaultPaths();
  let params = defaultParams();
  const rest: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;
    const next = args[index + 1];
    if (arg === '--table') {
      if (next === undefined) return { ok: false, message: 'usage: allocate --table <file>' };
      paths = { ...paths, table: next };
      index += 1;
    } else if (arg === '--stats') {
      if (next === undefined) return { ok: false, message: 'usage: allocate --stats <file>' };
      paths = { ...paths, stats: next };
      index += 1;
    } else if (arg === '--ledger') {
      if (next === undefined) return { ok: false, message: 'usage: allocate --ledger <file>' };
      paths = { ...paths, ledger: next };
      index += 1;
    } else if (arg === '--kappa') {
      if (next === undefined) return { ok: false, message: 'usage: allocate --kappa <n>' };
      const kappa = parseFiniteNumber(next);
      if (kappa === null) return { ok: false, message: `invalid --kappa ${next}` };
      params = { ...params, kappa };
      index += 1;
    } else if (arg === '--unlisted-prior') {
      if (next === undefined) return { ok: false, message: 'usage: allocate --unlisted-prior <n>' };
      const unlistedPrior = parseFiniteNumber(next);
      if (unlistedPrior === null) return { ok: false, message: `invalid --unlisted-prior ${next}` };
      params = { ...params, unlistedPrior };
      index += 1;
    } else {
      rest.push(arg);
    }
  }
  return { ok: true, paths, params, rest };
};

const normalizeAgent = (agent: string): string => agent.replace(/^cc-/u, '');

const normalizeResult = (raw: string): AllocationOutcome['result'] | null => {
  switch (raw.toLowerCase()) {
    case 'ok':
    case 'success':
    case 'pass':
    case '1':
    case 'win':
      return 'ok';
    case 'fail':
    case 'failure':
    case '0':
    case 'loss':
    case 'needsfix':
      return 'fail';
    default:
      return null;
  }
};

const seededOrSystemRng = (): Rng => {
  const seed = process.env.FUGUE_ALLOCATE_SEED;
  if (seed === undefined || seed.length === 0) return systemRng;
  const parsed = Number.parseInt(seed, 10);
  return seededRng(Number.isFinite(parsed) ? parsed : 0);
};

const stateLine = (entry: StrategyState[number]): string =>
  `${entry.taskType}\t${entry.agent}\t${String(entry.s)}\t${String(entry.f)}`;

const parseBench = (content: string): BenchTable => {
  const table = new Map<string, readonly string[]>();
  for (const line of content.split(/\r?\n/u)) {
    if (/^[ \t]*(#|$)/u.test(line)) continue;
    const [task, models] = line.split('\t');
    if (task === undefined || models === undefined || task.length === 0) continue;
    table.set(task, splitCsv(models));
  }
  return table;
};

const parseStats = (content: string): StrategyState => {
  const state: StrategyState[number][] = [];
  for (const line of content.split(/\r?\n/u)) {
    if (line.length === 0) continue;
    const [taskType, agent, rawS, rawF] = line.split('\t');
    const s = parseFiniteNumber(rawS ?? '');
    const f = parseFiniteNumber(rawF ?? '');
    if (taskType === undefined || agent === undefined || s === null || f === null) continue;
    state.push({ taskType, agent, s, f });
  }
  return state;
};

const formatRankList = (ranking: Ranking, top: boolean): string => {
  const names = ranking.map((entry) => entry.agent);
  return top ? (names[0] ?? '') : names.join(',');
};

class LegacyAllocationStore {
  private readonly fs = new NodeFileSystem();

  constructor(
    private readonly paths: AllocationPaths,
    private readonly params: AllocationParams,
  ) {}

  async bench(): Promise<BenchTable> {
    const content = await this.fs.read(this.paths.table);
    if (content === null) throw new Error(`no allocation table ${this.paths.table}`);
    return parseBench(content);
  }

  async state(): Promise<StrategyState> {
    return parseStats((await this.fs.read(this.paths.stats)) ?? '');
  }

  async saveState(state: StrategyState): Promise<void> {
    if (state.length === 0) {
      await this.fs.write(this.paths.stats, '');
      return;
    }
    await this.fs.write(this.paths.stats, `${state.map(stateLine).join('\n')}\n`);
  }

  async removeStats(): Promise<void> {
    await this.fs.remove(this.paths.stats);
  }

  async rank(
    taskType: string,
    sample: boolean,
  ): Promise<{
    readonly taskType: string;
    readonly ranking: Ranking;
    readonly fallback: boolean;
    readonly models: readonly string[];
  }> {
    const bench = await this.bench();
    const rng = seededOrSystemRng();
    const models = bench.get(taskType);
    if (models !== undefined) {
      return {
        taskType,
        ranking: rankAgents(taskType, bench, await this.state(), this.params, {
          sample,
          random: () => rng.next(),
        }),
        fallback: false,
        models,
      };
    }
    const fallbackModels = bench.get('fallback');
    if (fallbackModels === undefined) throw new Error('table has no fallback either');
    return {
      taskType: 'fallback',
      ranking: rankAgents('fallback', bench, await this.state(), this.params, {
        sample,
        random: () => rng.next(),
      }),
      fallback: true,
      models: fallbackModels,
    };
  }

  paramsForDisplay(): AllocationParams {
    return this.params;
  }

  async record(outcome: AllocationOutcome): Promise<StrategyState[number]> {
    const next = applyOutcome(await this.state(), {
      ...outcome,
      agent: normalizeAgent(outcome.agent),
    });
    await this.saveState(next);
    const entry = next.find(
      (candidate) =>
        candidate.taskType === outcome.taskType &&
        candidate.agent === normalizeAgent(outcome.agent),
    );
    if (entry === undefined)
      throw new Error(`failed to record ${outcome.taskType}/${outcome.agent}`);
    return entry;
  }

  async decay(gamma: number, taskType?: string): Promise<void> {
    await this.saveState(decayState(await this.state(), gamma, taskType));
  }

  async clearLedger(path = this.paths.ledger): Promise<void> {
    await this.fs.write(path, '');
  }

  async ledgerRows(path = this.paths.ledger): Promise<readonly (readonly [string, string])[]> {
    const content = await this.fs.read(path);
    if (content === null) throw new Error(`no ledger: ${path} (dispatch --task-type writes it)`);
    const rows: [string, string][] = [];
    for (const line of content.split(/\r?\n/u)) {
      if (line.length === 0) continue;
      const [task, agent] = line.split('\t');
      if (task === undefined || agent === undefined || task.length === 0 || agent.length === 0)
        continue;
      rows.push([task, agent]);
    }
    return rows;
  }
}

export class AllocateCommand extends Command {
  static override paths = [['allocate']];

  args = Option.Proxy();

  override async execute(): Promise<number> {
    const parsed = parseArgs(this.args);
    if (!parsed.ok) return this.error(parsed.message);
    const [sub, ...subArgs] = parsed.rest;
    if (sub === undefined) {
      return this.error(
        'usage: <task-type> [--top] [--sample] | list | record | feed | stats | reset | decay',
      );
    }
    if (sub === '-h' || sub === '--help') return this.renderHelp();

    const store = new LegacyAllocationStore(parsed.paths, parsed.params);
    try {
      switch (sub) {
        case 'list':
          return await this.list(store);
        case 'record':
          return await this.record(store, subArgs);
        case 'feed':
          return await this.feed(store, subArgs);
        case 'stats':
          return await this.stats(store, subArgs);
        case 'reset':
          return await this.reset(store, subArgs);
        case 'decay':
          return await this.decay(store, subArgs);
        default:
          return await this.rank(store, sub, subArgs);
      }
    } catch (error) {
      return this.error(error instanceof Error ? error.message : String(error));
    }
  }

  private renderHelp(): number {
    this.context.stdout.write(
      [
        'fugue allocate <task-type> [--top] [--sample]',
        'fugue allocate list',
        'fugue allocate record <task-type> <agent> <ok|fail>',
        'fugue allocate feed type:agent:result [...]',
        'fugue allocate feed --from-ledger --result ok|fail [--fail a,b] [--ok a,b] [--keep]',
        'fugue allocate stats <task-type>',
        'fugue allocate reset [<task-type>]',
        'fugue allocate decay [--gamma G] [--type T]',
        '',
      ].join('\n'),
    );
    return 0;
  }

  private async rank(
    store: LegacyAllocationStore,
    taskType: string,
    args: readonly string[],
  ): Promise<number> {
    let top = false;
    let sample = false;
    for (const arg of args) {
      if (arg === '--top') top = true;
      else if (arg === '--sample') sample = true;
      else return this.error(`unknown arg '${arg}'`);
    }
    const ranked = await store.rank(taskType, sample);
    if (ranked.fallback) {
      this.context.stderr.write(
        `fuguectl-allocate: unknown task type '${taskType}' → falling back to fallback (${ranked.models.join(
          ',',
        )})\n`,
      );
    }
    this.context.stdout.write(`${formatRankList(ranked.ranking, top)}\n`);
    return 0;
  }

  private async list(store: LegacyAllocationStore): Promise<number> {
    const bench = await store.bench();
    for (const [task, models] of bench.entries()) {
      this.context.stdout.write(`  ${task.padEnd(14)} ${models.join(',')}\n`);
    }
    return 0;
  }

  private async record(store: LegacyAllocationStore, args: readonly string[]): Promise<number> {
    const [taskType, rawAgent, rawResult] = args;
    if (taskType === undefined || rawAgent === undefined || rawResult === undefined)
      return this.error('usage: record <task-type> <agent> <ok|fail>');
    const result = normalizeResult(rawResult);
    if (result === null) return this.error(`<result> must be ok|fail (got '${rawResult}')`);
    const bench = await store.bench();
    if (!bench.has(taskType)) {
      this.context.stderr.write(
        `fuguectl-allocate: ⚠ '${taskType}' not in bench table (allocation.tsv) — allocate queries fall back to fallback, these records won't be read; to take effect add '${taskType}' to the table\n`,
      );
    }
    const agent = normalizeAgent(rawAgent);
    const entry = await store.record({ taskType, agent, result });
    this.context.stdout.write(
      `✓ record ${taskType}/${agent} ${result} → s=${String(entry.s)} f=${String(entry.f)}\n`,
    );
    return 0;
  }

  private async stats(store: LegacyAllocationStore, args: readonly string[]): Promise<number> {
    const taskArg = args[0];
    if (taskArg === undefined || taskArg.length === 0)
      return this.error('usage: stats <task-type>');
    const ranked = await store.rank(taskArg, false);
    const state = await store.state();
    const evidence = new Map(
      state
        .filter((entry) => entry.taskType === ranked.taskType)
        .map((entry) => [entry.agent, entry] as const),
    );
    const models = ranked.models;
    const params = store.paramsForDisplay();
    this.context.stdout.write(
      `── allocate stats: ${ranked.taskType} (kappa=${String(params.kappa)}) ──\n`,
    );
    this.context.stdout.write(
      `  ${'agent'.padEnd(12)} ${'score'.padEnd(8)} ${'s/f'.padEnd(6)} prior\n`,
    );
    for (const entry of ranked.ranking) {
      const item = evidence.get(entry.agent);
      const s = item?.s ?? 0;
      const f = item?.f ?? 0;
      const index = models.indexOf(entry.agent);
      const prior =
        index === -1 ? params.unlistedPrior : (models.length - index) / (models.length + 1);
      this.context.stdout.write(
        `  ${entry.agent.padEnd(12)} ${entry.score.toFixed(3).padEnd(8)} ${`${String(s)}/${String(f)}`.padEnd(
          6,
        )} ${prior.toFixed(2)}\n`,
      );
    }
    return 0;
  }

  private async reset(store: LegacyAllocationStore, args: readonly string[]): Promise<number> {
    const taskType = args[0];
    if (taskType === undefined || taskType.length === 0) {
      await store.removeStats();
      this.context.stdout.write('✓ cleared all real-world stats\n');
      return 0;
    }
    const next = (await store.state()).filter((entry) => entry.taskType !== taskType);
    await store.saveState(next);
    this.context.stdout.write(`✓ cleared real-world stats for '${taskType}'\n`);
    return 0;
  }

  private async decay(store: LegacyAllocationStore, args: readonly string[]): Promise<number> {
    let gamma = 0.5;
    let taskType: string | undefined;
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      const value = args[index + 1] ?? '';
      if (arg === '--gamma') {
        const parsed = parseFiniteNumber(value);
        if (parsed === null) return this.error(`--gamma must be in (0,1), got '${value}'`);
        gamma = parsed;
        index += 1;
      } else if (arg === '--type') {
        taskType = value;
        index += 1;
      } else {
        return this.error(`unknown arg '${arg ?? ''}'`);
      }
    }
    if (!(gamma > 0 && gamma < 1))
      return this.error(`--gamma must be in (0,1), got '${String(gamma)}'`);
    await store.decay(gamma, taskType);
    this.context.stdout.write(
      `✓ decay: s/f for ${taskType ?? 'all'} ×${String(
        gamma,
      )} (discount-forget stale stats; run after model upgrade)\n`,
    );
    return 0;
  }

  private async feed(store: LegacyAllocationStore, args: readonly string[]): Promise<number> {
    let fromLedger = false;
    let result: AllocationOutcome['result'] | null = null;
    let ledger: string | undefined;
    let keep = false;
    let failList: readonly string[] = [];
    let okList: readonly string[] = [];
    const tuples: string[] = [];
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      const value = args[index + 1] ?? '';
      if (arg === '--from-ledger') {
        fromLedger = true;
      } else if (arg === '--result') {
        result = normalizeResult(value);
        index += 1;
      } else if (arg === '--fail') {
        failList = splitCsv(value);
        index += 1;
      } else if (arg === '--ok') {
        okList = splitCsv(value);
        index += 1;
      } else if (arg === '--ledger') {
        ledger = value;
        index += 1;
      } else if (arg === '--keep') {
        keep = true;
      } else if (arg?.startsWith('-') === true) {
        return this.error(`unknown arg '${arg}'`);
      } else if (arg !== undefined) {
        tuples.push(arg);
      }
    }

    if (fromLedger) {
      if (result === null)
        return this.error(
          '--from-ledger needs --result ok|fail (whole-round default; override individuals with --fail/--ok)',
        );
      let n = 0;
      for (const [taskType, agent] of await store.ledgerRows(ledger)) {
        let rowResult = result;
        if (failList.includes(agent)) rowResult = 'fail';
        if (okList.includes(agent)) rowResult = 'ok';
        await store.record({ taskType, agent, result: rowResult });
        n += 1;
      }
      if (!keep) await store.clearLedger(ledger);
      this.context.stdout.write(
        `✓ feed: recorded ${String(n)} from ledger (default=${result} fail=[${failList.join(
          ' ',
        )}] ok=[${okList.join(' ')}]); ledger ${keep ? 'retained' : 'cleared'}\n`,
      );
      return 0;
    }

    if (tuples.length === 0)
      return this.error(
        'usage: feed type:agent:result [...] | feed --from-ledger --result ok|fail [--fail a,b]',
      );
    let n = 0;
    for (const tuple of tuples) {
      const [taskType, agent, rawResult] = tuple.split(':');
      if (
        taskType === undefined ||
        agent === undefined ||
        rawResult === undefined ||
        taskType.length === 0 ||
        agent.length === 0 ||
        rawResult.length === 0
      ) {
        return this.error(`tuple format type:agent:result, got '${tuple}'`);
      }
      const tupleResult = normalizeResult(rawResult);
      if (tupleResult === null) return this.error(`<result> must be ok|fail (got '${rawResult}')`);
      await store.record({ taskType, agent, result: tupleResult });
      n += 1;
    }
    this.context.stdout.write(`✓ feed: recorded ${String(n)}\n`);
    return 0;
  }

  private error(message: string): number {
    this.context.stderr.write(`${message}\n`);
    return 2;
  }
}
