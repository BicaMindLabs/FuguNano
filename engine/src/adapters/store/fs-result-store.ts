import type { Artifact, ArtifactKind } from '../../domain/artifact.js';
import type { ResultStore } from '../../domain/ports/result-store.js';
import type { FileSystem } from '../../infra/file-system.js';
import { fileKey, joinPath } from './paths.js';

interface StoredResult {
  readonly key: string;
  readonly artifacts: readonly Artifact[];
}

const ARTIFACT_KINDS: readonly ArtifactKind[] = ['diff', 'file', 'log', 'plan'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isArtifactKind = (value: unknown): value is ArtifactKind =>
  typeof value === 'string' && ARTIFACT_KINDS.includes(value as ArtifactKind);

const isArtifact = (value: unknown): value is Artifact => {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    isArtifactKind(value.kind) &&
    typeof value.uri === 'string' &&
    typeof value.sha256 === 'string'
  );
};

const isStoredResult = (value: unknown): value is StoredResult => {
  if (!isRecord(value)) return false;
  return (
    typeof value.key === 'string' &&
    Array.isArray(value.artifacts) &&
    value.artifacts.every(isArtifact)
  );
};

const parseStoredResult = (content: string, path: string): StoredResult => {
  const parsed = JSON.parse(content) as unknown;
  if (!isStoredResult(parsed)) throw new Error(`Invalid result store record at ${path}`);
  return parsed;
};

export class FsResultStore implements ResultStore {
  constructor(
    private readonly fs: FileSystem,
    private readonly rootDir: string,
  ) {}

  async put(key: string, artifacts: readonly Artifact[]): Promise<void> {
    const path = this.pathForKey(key);
    const record: StoredResult = { key, artifacts: [...artifacts] };
    await this.fs.write(path, `${JSON.stringify(record, null, 2)}\n`);
  }

  async get(key: string): Promise<readonly Artifact[] | null> {
    const path = this.pathForKey(key);
    const content = await this.fs.read(path);
    if (content === null) return null;
    return [...parseStoredResult(content, path).artifacts];
  }

  async keys(): Promise<readonly string[]> {
    const names = await this.fs.list(this.rootDir);
    const keys: string[] = [];

    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const path = joinPath(this.rootDir, name);
      const content = await this.fs.read(path);
      if (content === null) continue;
      try {
        keys.push(parseStoredResult(content, path).key);
      } catch {
        // corrupt or non-result file — skip
      }
    }

    return keys;
  }

  private pathForKey(key: string): string {
    return joinPath(this.rootDir, fileKey(key));
  }
}
