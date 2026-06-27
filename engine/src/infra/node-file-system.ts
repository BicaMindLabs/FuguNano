import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { FileSystem } from './file-system.js';

const isErrnoException = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && 'code' in error;

const isNotFound = (error: unknown): boolean => isErrnoException(error) && error.code === 'ENOENT';

const isMissing = (error: unknown): boolean =>
  isNotFound(error) || (isErrnoException(error) && error.code === 'ENOTDIR');

// Per-write counter so overlapping writes to the same path never share a temp file.
let writeSeq = 0;

export class NodeFileSystem implements FileSystem {
  async read(path: string): Promise<string | null> {
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async write(path: string, content: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    writeSeq += 1;
    const tempPath = `${path}.${process.pid}.${writeSeq}.tmp`;
    await writeFile(tempPath, content, 'utf8');
    await rename(tempPath, path);
  }

  async mtime(path: string): Promise<number | null> {
    try {
      const stats = await stat(path);
      return Math.floor(stats.mtimeMs);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async remove(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
  }

  async list(dir: string): Promise<readonly string[]> {
    try {
      return await readdir(dir);
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  }
}
