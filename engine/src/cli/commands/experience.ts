import { join as joinPath } from 'node:path';

import { Command, Option } from 'clipanion';

import { FsExperienceStore } from '../../adapters/experience/fs-experience-store.js';
import { isOk } from '../../domain/result.js';
import { systemClock } from '../../infra/clock.js';
import { NodeFileSystem } from '../../infra/node-file-system.js';
import { defaultExperienceDir } from '../default-paths.js';

const fs = (): NodeFileSystem => new NodeFileSystem();

const readStream = async (stream: NodeJS.ReadableStream): Promise<string> => {
  let out = '';
  for await (const chunk of stream) {
    out += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
  }
  return out.replace(/\n$/u, '');
};

const renderRecall = (title: string, body: string): string => `[experience] ${title}\n${body}\n\n`;

const parseLimit = (raw: string): number => {
  const limit = Number.parseInt(raw, 10);
  return Number.isFinite(limit) ? limit : 3;
};

const field = (content: string, key: string): string => {
  const prefix = `${key}:`;
  const line = content.split(/\r?\n/u).find((entry) => entry.startsWith(prefix));
  return line === undefined ? '' : line.slice(prefix.length).trim();
};

const section = (content: string, name: string): string => {
  const lines = content.split(/\r?\n/u);
  const start = lines.findIndex((line) => line === `## ${name}`);
  if (start === -1) return '';
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    body.push(line);
  }
  return body.join('\n').trim();
};

const meaningfulLogLines = (log: string): readonly string[] => {
  const lines = log
    .split(/\r?\n/u)
    .map((line) => line.replace(/^- /u, '').trim())
    .filter((line) => line.length > 0);
  const preferred = lines.filter((line) =>
    /accepted|ci|failed|fix|green|review|selected|verification|verified/u.test(line.toLowerCase()),
  );
  return (preferred.length > 0 ? preferred : lines).slice(-12);
};

const renderTaskExperience = (
  path: string,
  content: string,
  options: { readonly lesson?: string } = {},
): string => {
  const taskTitle = content.split(/\r?\n/u).find((line) => line.startsWith('# ')) ?? '# TASK';
  const status = field(content, 'Status');
  const completed = field(content, 'Completed');
  const requirements = section(content, 'Requirements');
  const outputFiles = section(content, 'Output files');
  const log = meaningfulLogLines(section(content, 'Log'));
  const completion =
    completed.length > 0 && completed !== '-'
      ? `Status: ${status} (completed ${completed})`
      : `Status: ${status}`;
  const notes =
    log.length === 0
      ? '- No audit log lines were present.'
      : log.map((line) => `- ${line}`).join('\n');
  return [
    `Source task: ${path}`,
    `Task: ${taskTitle.replace(/^#\s*/u, '')}`,
    completion,
    '',
    'Requirements:',
    requirements.length > 0 ? requirements : '(none recorded)',
    '',
    'Output files:',
    outputFiles.length > 0 ? outputFiles : '(none recorded)',
    '',
    ...(options.lesson === undefined ? [] : ['Relabeled lesson:', options.lesson, '']),
    'Reusable audit notes:',
    notes,
  ].join('\n');
};

const isCompletedTask = (content: string): boolean =>
  field(content, 'Status') === 'DONE' && !['', '-'].includes(field(content, 'Completed'));

const TERMINAL_FAILURE_STATUSES = new Set(['NEEDS_FIX', 'FAILED', 'BLOCKED']);

const isTerminalFailedTask = (content: string): boolean => {
  const status = field(content, 'Status');
  return TERMINAL_FAILURE_STATUSES.has(status) && !['', '-'].includes(field(content, 'Completed'));
};

abstract class ExperienceCommand extends Command {
  store = Option.String('--store', defaultExperienceDir());

  protected experienceStore(): FsExperienceStore {
    return new FsExperienceStore(fs(), systemClock, this.store);
  }
}

export class ExperienceAddCommand extends ExperienceCommand {
  static override paths = [['experience', 'add']];

  workspace = Option.String();
  title = Option.String();
  from = Option.String('--from');

  override async execute(): Promise<number> {
    const body =
      this.from === undefined ? await readStream(this.context.stdin) : await fs().read(this.from);
    if (body === null) {
      this.context.stderr.write(`no --from file ${this.from ?? ''}\n`);
      return 1;
    }
    const result = await this.experienceStore().add({
      workspace: this.workspace,
      title: this.title,
      body,
    });
    if (!isOk(result)) {
      this.context.stderr.write(`${result.error.detail}\n`);
      return 1;
    }
    this.context.stdout.write(
      `✓ experience stored: ${joinPath(this.store, result.value.workspace, `${result.value.slug}.md`)}\n`,
    );
    return 0;
  }
}

export class ExperienceLearnCommand extends ExperienceCommand {
  static override paths = [['experience', 'learn']];

  workspace = Option.String();
  title = Option.String();
  task = Option.String('--task');
  allowFailure = Option.Boolean('--allow-failure', false);
  lesson = Option.String('--lesson');

  override async execute(): Promise<number> {
    if (this.task === undefined || this.task.length === 0) {
      this.context.stderr.write('need --task <TASK.md>\n');
      return 1;
    }
    const content = await fs().read(this.task);
    if (content === null) {
      this.context.stderr.write(`no --task file ${this.task}\n`);
      return 1;
    }
    const completed = isCompletedTask(content);
    const lesson = this.lesson?.trim();
    if (!completed && !this.allowFailure) {
      this.context.stderr.write(
        'task is not DONE with a completion timestamp; run task done first\n',
      );
      return 1;
    }
    if (!completed) {
      if (!isTerminalFailedTask(content)) {
        this.context.stderr.write(
          'failed task learning requires a terminal non-DONE status with a completion timestamp\n',
        );
        return 1;
      }
      if (lesson === undefined || lesson.length === 0) {
        this.context.stderr.write(
          'failed task learning requires --allow-failure and --lesson <reusable lesson>\n',
        );
        return 1;
      }
    }
    const body =
      completed || lesson === undefined
        ? renderTaskExperience(this.task, content)
        : renderTaskExperience(this.task, content, { lesson });
    const result = await this.experienceStore().add({
      workspace: this.workspace,
      title: this.title,
      body,
    });
    if (!isOk(result)) {
      this.context.stderr.write(`${result.error.detail}\n`);
      return 1;
    }
    this.context.stdout.write(
      `✓ experience learned: ${joinPath(this.store, result.value.workspace, `${result.value.slug}.md`)}\n`,
    );
    return 0;
  }
}

export class ExperienceListCommand extends ExperienceCommand {
  static override paths = [['experience', 'list']];

  workspace = Option.String({ required: false });

  override async execute(): Promise<void> {
    const methods = await this.experienceStore().list(this.workspace);
    if (methods.length === 0) {
      this.context.stdout.write('(no experiences yet)\n');
      return;
    }
    for (const method of methods) {
      this.context.stdout.write(`  ${method.workspace.padEnd(12)} ${method.title}\n`);
    }
  }
}

export class ExperienceRecallCommand extends ExperienceCommand {
  static override paths = [['experience', 'recall']];

  workspace = Option.String();
  query = Option.String('--query');
  limit = Option.String('--limit', '3');

  override async execute(): Promise<void> {
    const options =
      this.query === undefined
        ? { limit: parseLimit(this.limit) }
        : { limit: parseLimit(this.limit), query: this.query };
    const methods = await this.experienceStore().recall(this.workspace, options);
    for (const method of methods) {
      this.context.stdout.write(renderRecall(method.title, method.body));
    }
  }
}

export class ExperienceShowCommand extends ExperienceCommand {
  static override paths = [['experience', 'show']];

  workspace = Option.String();
  slug = Option.String();

  override async execute(): Promise<number> {
    const path = joinPath(this.store, this.workspace, `${this.slug}.md`);
    const content = await fs().read(path);
    if (content === null) {
      this.context.stderr.write(`no experience ${this.workspace}/${this.slug}\n`);
      return 1;
    }
    this.context.stdout.write(content);
    return 0;
  }
}
