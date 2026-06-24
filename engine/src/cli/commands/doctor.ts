import { Command } from 'clipanion';

import { runRecon } from '../../adapters/doctor/recon.js';
import { recommend } from '../../domain/doctor.js';
import { NodeCommandRunner } from '../../infra/node-command-runner.js';

/** Backends probed by `fugue doctor` (launcher + the env vars that count as a configured key). */
const BACKENDS = [
  { launcher: 'cc-deepseek', keys: ['DEEPSEEK_API_KEY'] },
  { launcher: 'cc-glm', keys: ['GLM_API_KEY', 'ZAI_API_KEY'] },
  { launcher: 'cc-kimi', keys: ['KIMI_API_KEY', 'MOONSHOT_API_KEY'] },
  { launcher: 'cc-qwen', keys: ['QWEN_API_KEY', 'DASHSCOPE_API_KEY'] },
  { launcher: 'cc-doubao', keys: ['DOUBAO_API_KEY', 'ARK_API_KEY'] },
  { launcher: 'cc-minimax', keys: ['MINIMAX_API_KEY'] },
] as const;

/** `fugue doctor` — probe the environment and print roles, backends, and the recommended workflow. */
export class DoctorCommand extends Command {
  static override paths = [['doctor']];

  override async execute(): Promise<void> {
    const report = await runRecon(new NodeCommandRunner(), { backends: BACKENDS });
    const out = this.context.stdout;

    out.write('roles:\n');
    for (const role of report.roles) {
      out.write(`  ${role.present ? '✓' : '✗'} ${role.cli}\n`);
    }

    out.write('backends:\n');
    for (const backend of report.backends) {
      const ready = backend.installed && backend.keyConfigured;
      const note = backend.installed
        ? backend.keyConfigured
          ? 'ready'
          : 'no key'
        : 'not installed';
      out.write(`  ${ready ? '✓' : '✗'} ${backend.launcher} (${note})\n`);
    }

    out.write('\nrecommended:\n');
    for (const rec of recommend(report)) {
      out.write(`  • ${rec}\n`);
    }
  }
}
