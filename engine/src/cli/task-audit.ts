import type { FileSystem } from '../infra/file-system.js';
import { withFileLock } from '../infra/file-lock.js';

type AuditContent = string | ((current: string) => string);

export const shanghaiTimestamp = (date = new Date()): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const value = (type: string): string => parts.find((part) => part.type === type)?.value ?? '00';
  return `${value('year')}-${value('month')}-${value('day')} ${value('hour')}:${value('minute')}`;
};

export const appendTaskAudit = async (
  fs: FileSystem,
  task: string,
  content: AuditContent,
): Promise<boolean> =>
  withFileLock(fs, `${task}.lock`, shanghaiTimestamp(), async () => {
    const current = await fs.read(task);
    if (current === null) return false;
    await fs.append(task, typeof content === 'string' ? content : content(current));
    return true;
  });

export const appendTaskAuditLine = (
  fs: FileSystem,
  task: string,
  message: string,
): Promise<boolean> =>
  appendTaskAudit(
    fs,
    task,
    (current) => `${current.endsWith('\n') ? '' : '\n'}- [${shanghaiTimestamp()}] ${message}\n`,
  );
