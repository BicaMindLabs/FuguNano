/**
 * Narrow filesystem port — just what the stores need. Injected so adapters are
 * testable with an in-memory fake and so we never reach for `node:fs` in domain
 * or application code.
 */
export interface FileSystem {
  /** File contents, or null if it does not exist. */
  read(path: string): Promise<string | null>;
  /** Create a file only if absent, returning false when it already exists. */
  writeNew(path: string, content: string): Promise<boolean>;
  /** Write atomically (temp + rename), creating parent dirs as needed. */
  write(path: string, content: string): Promise<void>;
  /** Append content, creating parent dirs as needed. */
  append(path: string, content: string): Promise<void>;
  /** Last-modified epoch millis, or null if absent. */
  mtime(path: string): Promise<number | null>;
  /** Remove a file; no-op if absent. */
  remove(path: string): Promise<void>;
  /** Entry names directly under a directory (not recursive); empty if absent. */
  list(dir: string): Promise<readonly string[]>;
}
