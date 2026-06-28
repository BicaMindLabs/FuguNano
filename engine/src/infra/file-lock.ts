import type { FileSystem } from './file-system.js';

const DEFAULT_LOCK_WAIT_MS = 10_000;
const DEFAULT_LOCK_POLL_MS = 10;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

interface FileLockOptions {
  readonly waitMs?: number;
  readonly pollMs?: number;
}

export const withFileLock = async <T>(
  fs: FileSystem,
  lockPath: string,
  owner: string,
  action: () => Promise<T>,
  options: FileLockOptions = {},
): Promise<T> => {
  const waitMs = options.waitMs ?? DEFAULT_LOCK_WAIT_MS;
  const pollMs = options.pollMs ?? DEFAULT_LOCK_POLL_MS;
  const deadline = Date.now() + waitMs;

  while (true) {
    if (await fs.writeNew(lockPath, `${owner}\n`)) {
      try {
        return await action();
      } finally {
        await fs.remove(lockPath);
      }
    }

    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for lock ${lockPath}`);
    }

    await sleep(pollMs);
  }
};
