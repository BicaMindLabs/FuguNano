import type { EvolutionLineageEntry } from '../../domain/evolution-lineage.js';
import {
  parseEvolutionLineageEntry,
  renderEvolutionLineageEntry,
} from '../../domain/evolution-lineage.js';
import { err, ok } from '../../domain/result.js';
import type { Result } from '../../domain/result.js';
import type { FileSystem } from '../../infra/file-system.js';
import { joinPath } from '../store/paths.js';

export type LineageStoreError =
  | { readonly kind: 'invalid-record'; readonly detail: string }
  | { readonly kind: 'not-found'; readonly detail: string };

/** Filesystem lineage store: `<root>/<id>.json`, normally `.fugunano/evolution/<id>.json`. */
export class FsLineageStore {
  constructor(
    private readonly fs: FileSystem,
    private readonly rootDir: string,
  ) {}

  async put(entry: EvolutionLineageEntry): Promise<void> {
    await this.fs.write(this.path(entry.id), renderEvolutionLineageEntry(entry));
  }

  async get(id: string): Promise<Result<EvolutionLineageEntry, LineageStoreError>> {
    const content = await this.fs.read(this.path(id));
    if (content === null) {
      return err({ kind: 'not-found', detail: `no evolution lineage entry ${id}` });
    }
    const parsed = parseEvolutionLineageEntry(content);
    return parsed.ok ? ok(parsed.value) : err({ kind: 'invalid-record', detail: parsed.error });
  }

  async list(): Promise<Result<readonly EvolutionLineageEntry[], LineageStoreError>> {
    const names = (await this.fs.list(this.rootDir))
      .filter((name) => name.endsWith('.json'))
      .sort();
    const entries: EvolutionLineageEntry[] = [];
    for (const name of names) {
      const content = await this.fs.read(joinPath(this.rootDir, name));
      if (content === null) continue;
      const parsed = parseEvolutionLineageEntry(content);
      if (!parsed.ok) return err({ kind: 'invalid-record', detail: `${name}: ${parsed.error}` });
      entries.push(parsed.value);
    }
    return ok(entries);
  }

  private path(id: string): string {
    return joinPath(this.rootDir, `${id}.json`);
  }
}
