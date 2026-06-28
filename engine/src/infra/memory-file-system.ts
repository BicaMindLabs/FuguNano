import type { Clock } from './clock.js';
import type { FileSystem } from './file-system.js';

interface MemoryFile {
  readonly content: string;
  readonly mtime: number;
}

const trimTrailingSlashes = (path: string): string => {
  const trimmed = path.replace(/\/+$/u, '');
  return trimmed.length === 0 && path.startsWith('/') ? '/' : trimmed;
};

const listPrefix = (dir: string): string => {
  const normalized = trimTrailingSlashes(dir);
  if (normalized.length === 0) return '';
  if (normalized === '/') return '/';
  return `${normalized}/`;
};

export class MemoryFileSystem implements FileSystem {
  readonly #files = new Map<string, MemoryFile>();

  constructor(private readonly clock: Clock) {}

  read(path: string): Promise<string | null> {
    return Promise.resolve(this.#files.get(path)?.content ?? null);
  }

  write(path: string, content: string): Promise<void> {
    this.#files.set(path, { content, mtime: this.clock.now() });
    return Promise.resolve();
  }

  writeNew(path: string, content: string): Promise<boolean> {
    if (this.#files.has(path)) return Promise.resolve(false);
    this.#files.set(path, { content, mtime: this.clock.now() });
    return Promise.resolve(true);
  }

  append(path: string, content: string): Promise<void> {
    const existing = this.#files.get(path)?.content ?? '';
    this.#files.set(path, { content: `${existing}${content}`, mtime: this.clock.now() });
    return Promise.resolve();
  }

  mtime(path: string): Promise<number | null> {
    return Promise.resolve(this.#files.get(path)?.mtime ?? null);
  }

  remove(path: string): Promise<void> {
    this.#files.delete(path);
    return Promise.resolve();
  }

  list(dir: string): Promise<readonly string[]> {
    const prefix = listPrefix(dir);
    const names = new Set<string>();

    for (const path of this.#files.keys()) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      if (rest.length === 0) continue;
      const [name] = rest.split('/');
      if (name !== undefined && name.length > 0) names.add(name);
    }

    return Promise.resolve([...names].sort());
  }
}
