import { stat } from 'node:fs/promises';
import { isAbsolute, join as joinPath } from 'node:path';

import { Command, Option } from 'clipanion';

import { DefaultIntegrator } from '../../adapters/integrate/default-integrator.js';
import { GitVcsPort } from '../../adapters/integrate/git-vcs.js';
import type { AgentIntegration, Identity, IntegrationReport, Worktree } from '../../domain/vcs.js';
import type { Ownership } from '../../domain/ownership.js';
import { checkOwnership } from '../../domain/ownership-check.js';
import { NodeCommandRunner } from '../../infra/node-command-runner.js';
import { NodeFileSystem } from '../../infra/node-file-system.js';
import { appendTaskAudit } from '../task-audit.js';
import { splitCsv } from '../param-parse.js';

interface MissingIntegration {
  readonly agent: string;
  readonly path: string;
}

interface IntegrationView {
  readonly line: string;
  readonly bucket: 'picked' | 'nochange' | 'conflict' | 'violation' | 'missing' | 'error';
}

const identityFor = (name: string): Identity => ({ name, email: 'fugunano@local' });

const splitWords = (raw: string): readonly string[] =>
  raw
    .split(/\s+/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
};

const isGitRepo = async (path: string, runner: NodeCommandRunner): Promise<boolean> => {
  if (!(await pathExists(path))) return false;
  const result = await runner.run('git', ['-C', path, 'rev-parse', '--git-dir']);
  return result.code === 0;
};

const parseOwnership = (content: string): Ownership => {
  const ownership: Map<
    string,
    { readonly owned: readonly string[]; readonly forbidden: readonly string[] }
  > = new Map();
  for (const raw of content.split(/\r?\n/u)) {
    if (raw.trim().length === 0 || raw.trimStart().startsWith('#')) continue;
    const [agent, owned = '', forbidden = ''] = raw.split('\t');
    if (agent === undefined || agent.length === 0) continue;
    ownership.set(agent, { owned: splitCsv(owned), forbidden: splitCsv(forbidden) });
  }
  return ownership;
};

const filesText = (files: readonly string[] | undefined): string => (files ?? []).join(' ');

const shortSha = (sha: string | undefined): string => (sha ?? '').slice(0, 7);

const viewFor = (
  result: AgentIntegration,
  options: { readonly dry: boolean; readonly onConflict: 'abort' | 'skip' },
): IntegrationView => {
  const files = filesText(result.changedFiles);
  switch (result.outcome) {
    case 'picked':
      return options.dry
        ? { bucket: 'picked', line: `  ▸  would-pick ${result.agent}  (${files})` }
        : {
            bucket: 'picked',
            line: `  ✓  picked    ${result.agent}  ${shortSha(result.commitSha)}  (${files})`,
          };
    case 'nochange':
      return { bucket: 'nochange', line: `  —  no-change ${result.agent}` };
    case 'conflict':
      return options.onConflict === 'abort'
        ? {
            bucket: 'conflict',
            line: `  ✗  conflict  ${result.agent}  → aborted, main stays clean; needs manual cherry-pick/rebase ${result.commitSha ?? result.detail}`,
          }
        : {
            bucket: 'conflict',
            line: `  ✗  conflict  ${result.agent}  → conflict left in working tree(skip mode), after resolving git cherry-pick --continue`,
          };
    case 'violation':
      return {
        bucket: 'violation',
        line: `  ⚠  violation ${result.agent}  → out-of-bounds changes: ${filesText(
          result.violatingFiles,
        )} (owned/forbidden check failed; not integrated, human adjudication)`,
      };
    case 'error':
      return { bucket: 'error', line: `  ✗  error     ${result.agent}  → ${result.detail}` };
  }
};

const viewMissing = (missing: MissingIntegration): IntegrationView => ({
  bucket: 'missing',
  line: `  ?  missing   ${missing.agent}  (${missing.path} does not exist)`,
});

const summary = (views: readonly IntegrationView[]): string => {
  const count = (bucket: IntegrationView['bucket']): number =>
    views.filter((view) => view.bucket === bucket).length;
  const parts = [
    `${String(count('picked'))} picked`,
    `${String(count('nochange'))} no-change`,
    `${String(count('conflict'))} conflict`,
    `${String(count('violation'))} violation`,
    `${String(count('missing'))} missing`,
  ];
  const errors = count('error');
  if (errors > 0) parts.push(`${String(errors)} error`);
  return parts.join(' | ');
};

/** `fugue integrate --work <repo> --agents "a b"` — worktree cherry-pick integration. */
export class IntegrateCommand extends Command {
  static override paths = [['integrate']];

  work = Option.String('--work');
  agents = Option.String('--agents');
  wsParent = Option.String('--ws-parent', '.fugue-cc/workspaces');
  onConflict = Option.String('--onconflict', 'abort');
  ownershipPath = Option.String('--ownership');
  task = Option.String('--task');
  dry = Option.Boolean('--dry', false);

  override async execute(): Promise<number> {
    if (this.work === undefined || this.work.length === 0) return this.error('need --work <repo>');
    if (this.agents === undefined || this.agents.length === 0)
      return this.error('need --agents "a b c"');
    if (this.onConflict !== 'abort' && this.onConflict !== 'skip')
      return this.error('--onconflict must be abort|skip');
    const onConflict = this.onConflict;

    const runner = new NodeCommandRunner();
    if (!(await isGitRepo(this.work, runner)))
      return this.error(`--work is not a git repo: ${this.work}`);

    const fs = new NodeFileSystem();
    const ownership = await this.ownership(fs);
    if (ownership === null) return 2;

    const vcs = new GitVcsPort(runner);
    const requested = splitWords(this.agents);
    const worktrees = requested.map((agent) => ({ agent, path: this.worktreePath(agent) }));
    const missing: MissingIntegration[] = [];
    const present: Worktree[] = [];
    for (const worktree of worktrees) {
      if (await pathExists(worktree.path)) present.push(worktree);
      else missing.push(worktree);
    }

    const report = this.dry
      ? await this.dryReport(vcs, present, ownership)
      : await new DefaultIntegrator(vcs, identityFor('fuguectl-integrate')).integrate(
          this.work,
          present,
          {
            ...(ownership !== undefined ? { ownership } : {}),
            onConflict,
          },
        );

    const views = [
      ...missing.map(viewMissing),
      ...report.results.map((entry) =>
        viewFor(entry, {
          dry: this.dry,
          onConflict,
        }),
      ),
    ];
    const sum = summary(views);
    this.context.stdout.write(
      [`── integrate (work=${this.work}) ──`, ...views.map((view) => view.line), sum, ''].join(
        '\n',
      ),
    );
    await this.appendTask(fs, sum, views);
    return views.some(
      (view) =>
        view.bucket === 'conflict' || view.bucket === 'violation' || view.bucket === 'error',
    )
      ? 1
      : 0;
  }

  private worktreePath(agent: string): string {
    return isAbsolute(this.wsParent)
      ? joinPath(this.wsParent, agent)
      : joinPath(joinPath(this.work ?? '', this.wsParent), agent);
  }

  private async ownership(fs: NodeFileSystem): Promise<Ownership | undefined | null> {
    if (this.ownershipPath === undefined || this.ownershipPath.length === 0) return undefined;
    const content = await fs.read(this.ownershipPath);
    if (content === null) {
      this.context.stderr.write(`--ownership file not found: ${this.ownershipPath}\n`);
      return null;
    }
    return parseOwnership(content);
  }

  private async dryReport(
    vcs: GitVcsPort,
    worktrees: readonly Worktree[],
    ownership: Ownership | undefined,
  ): Promise<IntegrationReport> {
    const results: AgentIntegration[] = [];
    for (const worktree of worktrees) {
      const changedFiles = await vcs.changedFiles(worktree.path);
      if (changedFiles.length === 0) {
        results.push({
          agent: worktree.agent,
          outcome: 'nochange',
          detail: 'no changes to integrate',
        });
        continue;
      }
      if (ownership !== undefined) {
        const bad = checkOwnership(ownership, worktree.agent, changedFiles);
        if (bad.length > 0) {
          results.push({
            agent: worktree.agent,
            outcome: 'violation',
            detail: `out-of-bounds: ${bad.join(' ')}`,
            changedFiles,
            violatingFiles: bad,
          });
          continue;
        }
      }
      results.push({
        agent: worktree.agent,
        outcome: 'picked',
        detail: 'dry-run',
        changedFiles,
      });
    }
    return { results };
  }

  private async appendTask(
    fs: NodeFileSystem,
    sum: string,
    views: readonly IntegrationView[],
  ): Promise<void> {
    if (this.task === undefined) return;
    const wrote = await appendTaskAudit(
      fs,
      this.task,
      `\n### Integrate — ${sum}\n${views.map((view) => view.line).join('\n')}\n`,
    );
    if (!wrote) return;
    this.context.stderr.write(`→ written to ${this.task}\n`);
  }

  private error(message: string): number {
    this.context.stderr.write(`${message}\n`);
    return 2;
  }
}
