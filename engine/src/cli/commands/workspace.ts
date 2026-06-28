import { join as joinPath } from 'node:path';

import { Command, Option } from 'clipanion';

import { FsExperienceStore } from '../../adapters/experience/fs-experience-store.js';
import { FsWorkspaceStore } from '../../adapters/workspace/fs-workspace-store.js';
import {
  DEFAULT_ALLOCATION_PARAMS,
  type BenchTable,
  type StatEntry,
  type StrategyState,
} from '../../domain/allocation.js';
import { rankAgents } from '../../domain/allocation-score.js';
import {
  EXPERIENCE_SOURCE_KINDS,
  EXPERIENCE_TRUST_FILTERS,
  isExperienceSourceKind,
  isExperienceTrustFilter,
  renderExperienceMethod,
} from '../../domain/experience.js';
import type {
  ExperienceSourceKind,
  ExperienceTrustFilter,
  RecallOptions,
} from '../../domain/experience.js';
import { assembleContext, renderBundle } from '../../domain/prompt-render.js';
import type { Workspace } from '../../domain/workspace.js';
import { systemClock } from '../../infra/clock.js';
import type { FileSystem } from '../../infra/file-system.js';
import { NodeFileSystem } from '../../infra/node-file-system.js';
import {
  defaultAllocationStats,
  defaultAllocationTable,
  defaultExperienceDir,
  defaultWorkspacesDir,
} from '../default-paths.js';

const fs = (): NodeFileSystem => new NodeFileSystem();

const workspacePath = (dir: string, name: string): string => joinPath(dir, `${name}.workspace`);

const parseCsv = (value: string): readonly string[] =>
  value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const loadBench = async (fileSystem: FileSystem, path: string): Promise<BenchTable> => {
  const text = await fileSystem.read(path);
  const table = new Map<string, readonly string[]>();
  if (text === null) return table;
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const [taskType, models] = line.split('\t');
    if (taskType === undefined || models === undefined) continue;
    table.set(taskType.trim(), parseCsv(models));
  }
  return table;
};

const numberOrZero = (value: string | undefined): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const loadLegacyStats = async (fileSystem: FileSystem, path: string): Promise<StrategyState> => {
  const text = await fileSystem.read(path);
  if (text === null) return [];
  const state: StatEntry[] = [];
  for (const raw of text.split(/\r?\n/u)) {
    if (raw.trim().length === 0) continue;
    const [taskType, agent, s, f] = raw.split('\t');
    if (taskType === undefined || agent === undefined) continue;
    state.push({
      taskType,
      agent,
      s: numberOrZero(s),
      f: numberOrZero(f),
    });
  }
  return state;
};

const resolveModels = async (
  models: string,
  options: { readonly allocation: string; readonly stats: string },
): Promise<string> => {
  if (!models.startsWith('@bench:')) return models;
  const fileSystem = fs();
  const bench = await loadBench(fileSystem, options.allocation);
  const requested = models.slice('@bench:'.length);
  const taskType = bench.has(requested) ? requested : 'fallback';
  const state = await loadLegacyStats(fileSystem, options.stats);
  return rankAgents(taskType, bench, state, DEFAULT_ALLOCATION_PARAMS, {
    sample: false,
    random: () => 0.5,
  })
    .map((entry) => entry.agent)
    .join(',');
};

const loadWorkspace = async (dir: string, name: string): Promise<Workspace | null> =>
  await new FsWorkspaceStore(fs(), dir).get(name);

const recallOptions = (
  query: string | undefined,
  sourceKind: ExperienceSourceKind | undefined,
  sourceRef: string | undefined,
  limit: number | undefined,
  trust: ExperienceTrustFilter,
  maxAgeSeconds: number | undefined,
): RecallOptions => {
  let options: RecallOptions =
    query === undefined || query.trim().length === 0
      ? { limit: limit ?? 3, trust }
      : { limit: limit ?? 3, query, trust };
  if (sourceKind !== undefined) {
    options = { ...options, sourceKind };
  }
  if (sourceRef !== undefined) {
    options = { ...options, sourceRef };
  }
  if (maxAgeSeconds !== undefined) {
    options = { ...options, maxAgeSeconds };
  }
  return options;
};

const normalizeExperienceSource = (raw: string | undefined): string | undefined =>
  raw?.trim().toLowerCase();

const parseExperienceSource = (
  raw: string | undefined,
): ExperienceSourceKind | null | undefined => {
  const source = normalizeExperienceSource(raw);
  if (raw === undefined) return undefined;
  if (source === undefined || source.length === 0 || !isExperienceSourceKind(source)) {
    return null;
  }
  return source;
};

const experienceSourceError = (raw: string | undefined): string => {
  const source = normalizeExperienceSource(raw);
  const rendered = source === undefined || source.length === 0 ? '<empty>' : source;
  return `unknown --experience-source ${rendered}; expected one of ${EXPERIENCE_SOURCE_KINDS.join(', ')}\n`;
};

const parseExperienceSourceRef = (raw: string | undefined): string | null | undefined => {
  if (raw === undefined) return undefined;
  const value = raw.trim();
  return value.length === 0 ? null : value;
};

const experienceSourceRefError = (): string =>
  '--experience-source-ref must be a non-empty string\n';

const parseExperienceLimit = (raw: string | undefined): number | null | undefined => {
  if (raw === undefined) return undefined;
  const value = raw.trim();
  if (!/^\d+$/u.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return parsed > 0 ? parsed : null;
};

const experienceLimitError = (raw: string | undefined): string => {
  const rendered = raw === undefined || raw.trim().length === 0 ? '<empty>' : raw.trim();
  return `unknown --experience-limit ${rendered}; expected a positive integer\n`;
};

const parseExperienceMaxAgeDays = (raw: string | undefined): number | null | undefined => {
  if (raw === undefined) return undefined;
  const value = raw.trim();
  if (!/^\d+$/u.test(value)) return null;
  const days = Number.parseInt(value, 10);
  if (days <= 0) return null;
  const seconds = days * 86_400;
  return Number.isSafeInteger(seconds) ? seconds : null;
};

const experienceMaxAgeDaysError = (raw: string | undefined): string => {
  const rendered = raw === undefined || raw.trim().length === 0 ? '<empty>' : raw.trim();
  return `unknown --experience-max-age-days ${rendered}; expected a positive integer\n`;
};

const parseAutomaticExperienceTrust = (
  raw: string | undefined,
): ExperienceTrustFilter | null | undefined => {
  if (raw === undefined) return undefined;
  const value = raw.trim().toLowerCase();
  return isExperienceTrustFilter(value) && value !== 'untrusted' ? value : null;
};

const automaticExperienceTrustError = (raw: string | undefined): string => {
  const rendered = raw === undefined || raw.trim().length === 0 ? '<empty>' : raw.trim();
  const filters = EXPERIENCE_TRUST_FILTERS.filter((filter) => filter !== 'untrusted');
  return `unknown --experience-trust ${rendered}; expected one of ${filters.join(', ')}\n`;
};

const optionsFor = (
  command: WorkspaceCommandOptions,
): { readonly allocation: string; readonly stats: string } => ({
  allocation: command.allocation,
  stats: command.stats,
});

abstract class WorkspaceCommand extends Command {
  dir = Option.String('--dir', defaultWorkspacesDir(import.meta.url));
}

abstract class WorkspaceCommandOptions extends WorkspaceCommand {
  allocation = Option.String('--allocation', defaultAllocationTable(import.meta.url));
  stats = Option.String('--stats', defaultAllocationStats());
}

export class WorkspaceListCommand extends WorkspaceCommand {
  static override paths = [['workspace', 'list']];

  override async execute(): Promise<void> {
    const store = new FsWorkspaceStore(fs(), this.dir);
    for (const name of await store.list()) {
      const workspace = await store.get(name);
      this.context.stdout.write(`  ${name.padEnd(10)} ${(workspace?.prompt ?? '').slice(0, 44)}\n`);
    }
  }
}

export class WorkspaceShowCommand extends WorkspaceCommand {
  static override paths = [['workspace', 'show']];

  name = Option.String();

  override async execute(): Promise<number> {
    const content = await fs().read(workspacePath(this.dir, this.name));
    if (content === null) {
      this.context.stderr.write(`no workspace '${this.name}' (see list)\n`);
      return 1;
    }
    this.context.stdout.write(content);
    return 0;
  }
}

export class WorkspaceModelCommand extends WorkspaceCommandOptions {
  static override paths = [['workspace', 'model']];

  name = Option.String();

  override async execute(): Promise<number> {
    const workspace = await loadWorkspace(this.dir, this.name);
    if (workspace === null) {
      this.context.stderr.write(`no workspace '${this.name}'\n`);
      return 1;
    }
    this.context.stdout.write(`${await resolveModels(workspace.models, optionsFor(this))}\n`);
    return 0;
  }
}

export class WorkspaceContextCommand extends WorkspaceCommandOptions {
  static override paths = [['workspace', 'context']];

  name = Option.String();
  task = Option.String('--task');
  query = Option.String('--query');
  experience = Option.String('--experience', defaultExperienceDir());
  experienceSource = Option.String('--experience-source');
  experienceSourceRef = Option.String('--experience-source-ref');
  experienceLimit = Option.String('--experience-limit');
  experienceTrust = Option.String('--experience-trust');
  experienceMaxAgeDays = Option.String('--experience-max-age-days');

  override async execute(): Promise<number> {
    const experienceSource = parseExperienceSource(this.experienceSource);
    if (experienceSource === null) {
      this.context.stderr.write(experienceSourceError(this.experienceSource));
      return 2;
    }
    const experienceSourceRef = parseExperienceSourceRef(this.experienceSourceRef);
    if (experienceSourceRef === null) {
      this.context.stderr.write(experienceSourceRefError());
      return 2;
    }
    const experienceLimit = parseExperienceLimit(this.experienceLimit);
    if (experienceLimit === null) {
      this.context.stderr.write(experienceLimitError(this.experienceLimit));
      return 2;
    }
    const experienceTrust = parseAutomaticExperienceTrust(this.experienceTrust);
    if (experienceTrust === null) {
      this.context.stderr.write(automaticExperienceTrustError(this.experienceTrust));
      return 2;
    }
    const experienceMaxAgeSeconds = parseExperienceMaxAgeDays(this.experienceMaxAgeDays);
    if (experienceMaxAgeSeconds === null) {
      this.context.stderr.write(experienceMaxAgeDaysError(this.experienceMaxAgeDays));
      return 2;
    }
    const fileSystem = fs();
    const store = new FsWorkspaceStore(fileSystem, this.dir);
    const workspace = await store.get(this.name);
    if (workspace === null) {
      this.context.stderr.write(`no workspace '${this.name}' (see list)\n`);
      return 1;
    }
    const models = await resolveModels(workspace.models, optionsFor(this));
    const experienceStore = new FsExperienceStore(fileSystem, systemClock, this.experience);
    const methods = await experienceStore.recall(
      this.name,
      recallOptions(
        this.query ?? this.task,
        experienceSource,
        experienceSourceRef,
        experienceLimit,
        experienceTrust ?? 'trusted',
        experienceMaxAgeSeconds,
      ),
    );
    this.context.stdout.write(
      renderBundle(
        assembleContext({
          workspace: { ...workspace, models },
          system: await store.systemPrompt(),
          experience: methods.map(renderExperienceMethod),
          ...(this.task !== undefined ? { task: this.task } : {}),
        }),
      ),
    );
    return 0;
  }
}
