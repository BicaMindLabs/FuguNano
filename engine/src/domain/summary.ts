import type { RoundManifest } from './round.js';
import { stateOf, tally } from './round.js';

/** Human-readable round observability summary (bash `summary`): per-key state + tally (+ elapsed). */
export const renderSummary = (manifest: RoundManifest, elapsedMs?: number): string => {
  const counts = tally(manifest);
  const lines = [`## Round ${manifest.round} summary`, ''];
  for (const key of manifest.expected) lines.push(`- ${key}: ${stateOf(manifest, key)}`);
  lines.push(
    '',
    `done ${counts.done} / fail ${counts.fail} / timeout ${counts.timeout} / ` +
      `canceled ${counts.canceled} / pending ${counts.pending} (of ${manifest.expected.length})`,
  );
  if (elapsedMs !== undefined) lines.push(`elapsed: ${Math.round(elapsedMs / 1000)}s`);
  return lines.join('\n');
};
