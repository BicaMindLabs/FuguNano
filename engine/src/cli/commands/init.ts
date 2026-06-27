import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join as joinPath, resolve } from 'node:path';

import { Command, Option } from 'clipanion';

import type { CommandRunner } from '../../infra/command-runner.js';
import { NodeCommandRunner } from '../../infra/node-command-runner.js';
import { repoRoot } from '../default-paths.js';

const SECRET_KEYS = [
  'DEEPSEEK_API_KEY',
  'GLM_API_KEY',
  'ZAI_API_KEY',
  'KIMI_API_KEY',
  'MOONSHOT_API_KEY',
  'QWEN_API_KEY',
  'DASHSCOPE_API_KEY',
  'ARK_API_KEY',
  'DOUBAO_API_KEY',
  'MINIMAX_API_KEY',
  'MIMO_API_KEY',
  'STEPFUN_API_KEY',
  'OPENAI_API_KEY',
] as const;

const shellQuote = (value: string): string => `'${value.replace(/'/gu, "'\\''")}'`;

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
};

const commandExists = async (runner: CommandRunner, command: string): Promise<boolean> => {
  try {
    return (
      (await runner.run('bash', ['-lc', `command -v ${shellQuote(command)} >/dev/null 2>&1`]))
        .code === 0
    );
  } catch {
    return false;
  }
};

const defaultSecretsPath = (): string =>
  process.env.FUGUE_SECRETS ?? joinPath(homedir(), '.config', 'cc-model-secrets.env');

const providerExamplePath = (): string =>
  joinPath(repoRoot(import.meta.url), 'orchestration', 'fugue-cc', 'provider.config.example');

const secretsTemplate = (): string =>
  [
    '# FuguNano local model credentials',
    '# Keep this file outside any repo. Fill only the providers you use.',
    '# Empty values are safe placeholders.',
    '',
    ...SECRET_KEYS.map((key) => `${key}=`),
    '',
  ].join('\n');

const hasFugueCcIgnore = async (project: string): Promise<boolean> => {
  try {
    const text = await readFile(joinPath(project, '.gitignore'), 'utf8');
    return text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .some((line) => line === '.fugue-cc/' || line === '**/.fugue-cc/');
  } catch {
    return false;
  }
};

const statusLine = (ok: boolean, okText: string, warnText: string): string =>
  ok ? `  ✓ ${okText}` : `  ⚠ ${warnText}`;

/** `fugue init` — safe first-run readiness report plus explicit scaffold creation. */
export class InitCommand extends Command {
  static override paths = [['init']];

  dryRun = Option.Boolean('--dry-run', false);
  write = Option.Boolean('--write', false);
  project = Option.String('--project', process.cwd());
  secrets = Option.String('--secrets', defaultSecretsPath());
  providerConfig = Option.String('--provider-config');

  override async execute(): Promise<number> {
    if (this.dryRun && this.write) {
      this.context.stderr.write('choose either --dry-run or --write, not both\n');
      return 2;
    }

    const project = resolve(this.project);
    const secrets = resolve(this.secrets);
    const providerConfig = resolve(
      this.providerConfig ?? joinPath(project, '.fugue-cc', 'provider.config'),
    );
    const providerExample = providerExamplePath();
    const runner = new NodeCommandRunner();

    const beforeSecrets = await pathExists(secrets);
    const beforeProvider = await pathExists(providerConfig);
    const providerExampleExists = await pathExists(providerExample);

    const actions: string[] = [];
    const willWrite = this.write;

    if (!beforeSecrets) {
      if (willWrite) {
        await mkdir(dirname(secrets), { recursive: true });
        await writeFile(secrets, secretsTemplate(), { encoding: 'utf8', flag: 'wx' });
        actions.push(`created secrets template: ${secrets}`);
      } else {
        actions.push(`would create secrets template: ${secrets}`);
      }
    }

    if (!beforeProvider) {
      if (willWrite) {
        if (!providerExampleExists) {
          this.context.stderr.write(`provider example missing: ${providerExample}\n`);
          return 1;
        }
        await mkdir(dirname(providerConfig), { recursive: true });
        await copyFile(providerExample, providerConfig, constants.COPYFILE_EXCL);
        actions.push(`copied provider config example: ${providerConfig}`);
      } else {
        actions.push(`would copy provider config example: ${providerConfig}`);
      }
    }

    const secretsReady = beforeSecrets || (willWrite && (await pathExists(secrets)));
    const providerReady = beforeProvider || (willWrite && (await pathExists(providerConfig)));
    const gitignoreReady = await hasFugueCcIgnore(project);
    const codexReady = await commandExists(runner, 'codex');
    const opencodeReady = await commandExists(runner, 'opencode');
    const agyReady = await commandExists(runner, 'agy');
    const fugueCcReady = await commandExists(runner, 'fugue-cc');

    const lines = [
      `── FuguNano init (${willWrite ? 'write' : 'dry-run'}) ──`,
      `project: ${project}`,
      `secrets: ${secrets}`,
      `provider config: ${providerConfig}`,
      '',
      'readiness:',
      statusLine(codexReady, 'Codex CLI detected', 'Codex CLI missing'),
      statusLine(opencodeReady, 'OpenCode CLI detected', 'OpenCode CLI missing'),
      statusLine(agyReady, 'Antigravity CLI detected', 'Antigravity CLI missing'),
      statusLine(
        fugueCcReady,
        'fugue-cc fleet CLI detected',
        'fugue-cc fleet CLI missing (optional)',
      ),
      statusLine(secretsReady, 'secrets file ready', 'secrets file missing'),
      statusLine(providerReady, 'provider config ready', 'provider config missing'),
      statusLine(
        providerExampleExists,
        'provider config example available',
        'provider config example missing',
      ),
      statusLine(gitignoreReady, '.fugue-cc/ ignored by git', '.fugue-cc/ not ignored here'),
      '',
      'actions:',
      ...(actions.length > 0
        ? actions.map((action) => `  • ${action}`)
        : ['  • nothing to create']),
      '',
      'next:',
      '  1. fuguectl preflight --harness codex',
      '  2. fuguectl preflight --harness agy',
      '  3. fuguectl plan "your goal" --harness codex --out /tmp/fugunano-plan',
      '  4. fuguectl preflight --harness fugue-cc   # optional full worktree fleet',
    ];

    if (!willWrite) lines.push('', 'pass --write to create missing local templates');

    this.context.stdout.write(`${lines.join('\n')}\n`);
    return 0;
  }
}
