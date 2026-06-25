import { basename, join as joinPath } from 'node:path';

import { Command, Option } from 'clipanion';

import type { LoopRound, LoopState } from '../../domain/loop.js';
import { decideLoop } from '../../domain/loop-decide.js';
import { NodeFileSystem } from '../../infra/node-file-system.js';

interface ParsedArgs {
  readonly ok: true;
  readonly cache: string | null;
  readonly rest: readonly string[];
}

interface ParseError {
  readonly ok: false;
  readonly message: string;
}

interface RunMeta {
  readonly task: string;
  readonly round: number;
}

interface CacheSnapshot {
  readonly initialized: boolean;
  readonly total: number;
  readonly done: number;
  readonly fail: number;
  readonly pending: number;
  readonly barrier: 'open' | 'passed' | null;
}

interface LoopSnapshot {
  readonly initialized: boolean;
  readonly max: number | null;
  readonly rounds: number;
  readonly best_n: number | null;
  readonly best_sha: string | null;
  readonly decision: LoopState | null;
}

interface RunSnapshot {
  readonly task: string;
  readonly task_status: string | null;
  readonly round: number;
  readonly cache: CacheSnapshot;
  readonly loop: LoopSnapshot;
  readonly next: string;
}

type ParseResult = ParsedArgs | ParseError;

const defaultCacheRoot = (): string =>
  process.env.FUGUE_CACHE ?? joinPath(process.cwd(), '.fuguectl-cache');

const parseArgs = (args: readonly string[]): ParseResult => {
  let cache: string | null = null;
  const rest: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === undefined) continue;
    if (arg === '--cache') {
      const next = args[index + 1];
      if (next === undefined)
        return { ok: false, message: 'usage: run --cache <dir> <subcommand>' };
      cache = next;
      index += 1;
    } else if (arg.startsWith('--cache=')) {
      cache = arg.slice('--cache='.length);
    } else {
      rest.push(arg);
    }
  }
  return { ok: true, cache, rest };
};

const parseFields = (content: string): Readonly<Record<string, string>> => {
  const fields: Record<string, string> = {};
  for (const line of content.split(/\r?\n/u)) {
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    fields[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return fields;
};

const parsePositiveInteger = (raw: string): number | null => {
  if (!/^[1-9][0-9]*$/u.test(raw)) return null;
  return Number.parseInt(raw, 10);
};

const parseIntegerOrNull = (raw: string | undefined): number | null => {
  if (raw === undefined || raw.length === 0 || !/^-?[0-9]+$/u.test(raw)) return null;
  return Number.parseInt(raw, 10);
};

const nonEmptyLines = (content: string): readonly string[] =>
  content.split(/\r?\n/u).filter((line) => line.length > 0);

const statusFromTask = (taskContent: string | null): string | null => {
  if (taskContent === null) return null;
  for (const line of taskContent.split(/\r?\n/u)) {
    const match = /^Status:[ \t]*(.*)$/u.exec(line);
    if (match?.[1] !== undefined) return match[1];
  }
  return null;
};

const emptyCache = (): CacheSnapshot => ({
  initialized: false,
  total: 0,
  done: 0,
  fail: 0,
  pending: 0,
  barrier: null,
});

const emptyLoop = (): LoopSnapshot => ({
  initialized: false,
  max: null,
  rounds: 0,
  best_n: null,
  best_sha: null,
  decision: null,
});

const parseLoopRound = (line: string): LoopRound | null => {
  const [rawRound, gate, verdict, rawFindings, rawAsk, rawSame, sha, note] = line.split('\t');
  const round = rawRound === undefined ? null : parsePositiveInteger(rawRound);
  const findings = rawFindings === undefined ? null : parseIntegerOrNull(rawFindings);
  const intentFindings = rawAsk === undefined ? 0 : parseIntegerOrNull(rawAsk);
  if (round === null || findings === null || intentFindings === null) return null;
  if (gate !== 'pass' && gate !== 'fail') return null;
  if (verdict !== 'ACCEPTED' && verdict !== 'NEEDSFIX') return null;
  const base = {
    round,
    gate,
    verdict: verdict === 'ACCEPTED' ? 'ACCEPTED' : 'NEEDS_FIX',
    findings,
    intentFindings,
    sameClass: rawSame === '1',
  } satisfies Omit<LoopRound, 'sha' | 'note'>;
  return {
    ...base,
    ...(sha !== undefined && sha.length > 0 ? { sha } : {}),
    ...(note !== undefined && note.length > 0 ? { note } : {}),
  };
};

const nextFor = (snapshot: Omit<RunSnapshot, 'next'>): string => {
  if (snapshot.cache.initialized && snapshot.cache.pending > 0) {
    return `cache barrier: waiting on ${String(snapshot.cache.done)}+${String(snapshot.cache.fail)}/${String(
      snapshot.cache.total,
    )} returned (still need ${String(snapshot.cache.pending)}) — do not enter Integrate`;
  }
  if (snapshot.loop.decision !== null) {
    return `loop: ${snapshot.loop.decision} — see fuguectl loop decide`;
  }
  if (snapshot.cache.initialized) {
    return `cache barrier passed (${String(snapshot.cache.total)}/${String(snapshot.cache.total)}) — may Integrate`;
  }
  return 'run declared; no cache/loop state yet — start round / dispatch';
};

class LegacyRunFacade {
  private readonly fs = new NodeFileSystem();

  constructor(private readonly cacheRoot: string) {}

  async set(task: string, round: number): Promise<void> {
    await this.fs.write(this.runPath(), `task=${task}\nround=${String(round)}\n`);
  }

  async patchRound(round: number): Promise<string | null> {
    const meta = await this.loadRun();
    if (meta === null) return null;
    await this.set(meta.task, round);
    return meta.task;
  }

  async clear(): Promise<void> {
    await this.fs.remove(this.runPath());
  }

  async snapshot(): Promise<RunSnapshot | null> {
    const meta = await this.loadRun();
    if (meta === null) return null;
    const withoutNext = {
      task: meta.task,
      task_status: statusFromTask(await this.fs.read(meta.task)),
      round: meta.round,
      cache: await this.cacheSnapshot(meta.round),
      loop: await this.loopSnapshot(),
    };
    return { ...withoutNext, next: nextFor(withoutNext) };
  }

  private runPath(): string {
    return joinPath(this.cacheRoot, 'run.meta');
  }

  private async loadRun(): Promise<RunMeta | null> {
    const content = await this.fs.read(this.runPath());
    if (content === null) return null;
    const fields = parseFields(content);
    const task = fields.task ?? '';
    const round = parsePositiveInteger(fields.round ?? '') ?? 1;
    return { task, round };
  }

  private async cacheSnapshot(round: number): Promise<CacheSnapshot> {
    const dir = joinPath(this.cacheRoot, `round-${String(round)}`);
    const manifest = await this.fs.read(joinPath(dir, 'manifest.tsv'));
    if (manifest === null) return emptyCache();
    const ids = nonEmptyLines(manifest).map((line) => line.split('\t')[0] ?? '');
    let done = 0;
    let fail = 0;
    for (const id of ids) {
      const status = (await this.fs.read(joinPath(dir, `${id}.status`)))?.trim();
      if (status === 'done') done += 1;
      if (status === 'fail') fail += 1;
    }
    const pending = ids.length - done - fail;
    return {
      initialized: true,
      total: ids.length,
      done,
      fail,
      pending,
      barrier: pending === 0 ? 'passed' : 'open',
    };
  }

  private async loopSnapshot(): Promise<LoopSnapshot> {
    const dir = joinPath(this.cacheRoot, 'loop');
    const metaContent = await this.fs.read(joinPath(dir, 'meta'));
    if (metaContent === null) return emptyLoop();
    const meta = parseFields(metaContent);
    const roundLines = nonEmptyLines((await this.fs.read(joinPath(dir, 'rounds.tsv'))) ?? '');
    const rounds = roundLines.map(parseLoopRound).filter((round) => round !== null);
    let decision: LoopState | null = null;
    const maxRounds = parsePositiveInteger(meta.max_rounds ?? '');
    if (rounds.length > 0 && maxRounds !== null) {
      try {
        decision = decideLoop(rounds, { maxRounds }).state;
      } catch {
        decision = null;
      }
    }
    return {
      initialized: true,
      max: maxRounds,
      rounds: roundLines.length,
      best_n: parseIntegerOrNull(meta.best_n),
      best_sha: meta.best_sha !== undefined && meta.best_sha.length > 0 ? meta.best_sha : null,
      decision,
    };
  }
}

export class RunCommand extends Command {
  static override paths = [['run']];

  args = Option.Proxy();

  override async execute(): Promise<number> {
    const parsed = parseArgs(this.args);
    if (!parsed.ok) return this.error(parsed.message);

    const [sub, ...subArgs] = parsed.rest;
    if (sub === undefined || sub === '-h' || sub === '--help') {
      this.context.stdout.write(
        [
          'fugue run set --task <file> [--round N]',
          'fugue run round <N>',
          'fugue run status [--human]',
          'fugue run next',
          'fugue run clear',
          '',
        ].join('\n'),
      );
      return 0;
    }

    const facade = new LegacyRunFacade(parsed.cache ?? defaultCacheRoot());
    switch (sub) {
      case 'set':
        return await this.set(facade, subArgs);
      case 'round':
        return await this.round(facade, subArgs);
      case 'status':
        return await this.status(facade, subArgs);
      case 'next':
        return await this.next(facade);
      case 'clear':
        await facade.clear();
        this.context.stdout.write('✓ cleared current run context\n');
        return 0;
      default:
        return this.error(`unknown subcommand '${sub}' (set|round|status|next|clear)`);
    }
  }

  private async set(facade: LegacyRunFacade, args: readonly string[]): Promise<number> {
    const options = this.parseSetOptions(args);
    if (!options.ok) return this.error(options.message);
    if ((await new NodeFileSystem().read(options.task)) === null)
      return this.error(`no TASK file: ${options.task}`);
    await facade.set(options.task, options.round);
    this.context.stdout.write(
      `✓ active run: task=${options.task} round=${String(options.round)}\n`,
    );
    return 0;
  }

  private async round(facade: LegacyRunFacade, args: readonly string[]): Promise<number> {
    const round = parsePositiveInteger(args[0] ?? '');
    if (round === null) return this.error('usage: round <N≥1>');
    const task = await facade.patchRound(round);
    if (task === null) return this.error('no active run (first fuguectl run set --task ...)');
    this.context.stdout.write(`✓ round → ${String(round)}\n`);
    return 0;
  }

  private async status(facade: LegacyRunFacade, args: readonly string[]): Promise<number> {
    const human = args[0] === '--human';
    const snapshot = await facade.snapshot();
    if (snapshot === null) return this.error('no active run (first fuguectl run set --task ...)');
    this.context.stdout.write(
      human ? this.renderHuman(snapshot) : `${JSON.stringify(snapshot, null, 2)}\n`,
    );
    return 0;
  }

  private async next(facade: LegacyRunFacade): Promise<number> {
    const snapshot = await facade.snapshot();
    if (snapshot === null) return this.error('no active run (first fuguectl run set --task ...)');
    this.context.stdout.write(`${snapshot.next}\n`);
    return 0;
  }

  private parseSetOptions(
    args: readonly string[],
  ):
    | { readonly ok: true; readonly task: string; readonly round: number }
    | { readonly ok: false; readonly message: string } {
    let task = '';
    let round = 1;
    for (let index = 0; index < args.length; index += 1) {
      const arg = args[index];
      if (arg === '--task') {
        task = args[index + 1] ?? '';
        index += 1;
      } else if (arg === '--round') {
        const parsed = parsePositiveInteger(args[index + 1] ?? '');
        if (parsed === null) return { ok: false, message: '--round must be ≥1' };
        round = parsed;
        index += 1;
      } else {
        return { ok: false, message: `unknown arg '${arg ?? ''}'` };
      }
    }
    if (task.length === 0) return { ok: false, message: 'usage: set --task <file> [--round N]' };
    return { ok: true, task, round };
  }

  private renderHuman(snapshot: RunSnapshot): string {
    const status = snapshot.task_status ?? '?';
    const barrier = snapshot.cache.barrier ?? 'null';
    const decision = snapshot.loop.decision ?? 'null';
    return [
      `-- run: ${basename(snapshot.task)} | round ${String(snapshot.round)} | ${status} --`,
      `  cache:  init=${String(snapshot.cache.initialized)} total=${String(
        snapshot.cache.total,
      )} done=${String(snapshot.cache.done)} fail=${String(snapshot.cache.fail)} pending=${String(
        snapshot.cache.pending,
      )} barrier=${barrier}`,
      `  loop:   init=${String(snapshot.loop.initialized)} max=${String(snapshot.loop.max)} rounds=${String(
        snapshot.loop.rounds,
      )} best_n=${String(snapshot.loop.best_n)} decision=${decision}`,
      `  next:   ${snapshot.next}`,
      '',
    ].join('\n');
  }

  private error(message: string): number {
    this.context.stderr.write(`${message}\n`);
    return 2;
  }
}
