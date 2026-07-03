import { Command, Option } from 'clipanion';

import type { Candidate, SelectorConfig } from '../../domain/selector.js';
import { DEFAULT_SELECTOR_CONFIG, route } from '../../domain/selector.js';
import { NodeFileSystem } from '../../infra/node-file-system.js';

const readStream = async (stream: AsyncIterable<Buffer | string>): Promise<string> => {
  const chunks: string[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
  }
  return chunks.join('');
};

interface RouteInput {
  readonly candidates: readonly Candidate[];
  readonly category?: string;
}

/** Accepts either a bare candidate array or {candidates, category}. */
const parseInput = (raw: string): RouteInput | string => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'input is not valid JSON';
  }
  const body = Array.isArray(parsed) ? { candidates: parsed } : parsed;
  if (typeof body !== 'object' || body === null || !('candidates' in body))
    return 'input must be a candidate array or {candidates: [...]}';
  const { candidates, category } = body as { candidates: unknown; category?: unknown };
  if (!Array.isArray(candidates)) return 'candidates must be an array';
  if (category !== undefined && typeof category !== 'string') return 'category must be a string';
  for (const c of candidates) {
    if (typeof c !== 'object' || c === null) return 'every candidate must be an object';
    const { agent, verified, label } = c as {
      agent?: unknown;
      verified?: unknown;
      label?: unknown;
    };
    if (typeof agent !== 'string' || agent.length === 0)
      return 'every candidate needs a string `agent`';
    if (verified !== undefined && typeof verified !== 'boolean')
      return `candidate '${agent}': \`verified\` must be a boolean when present`;
    if (label !== undefined && typeof label !== 'string')
      return `candidate '${agent}': \`label\` must be a string when present`;
  }
  return {
    candidates: candidates as readonly Candidate[],
    ...(typeof category === 'string' ? { category } : {}),
  };
};

/**
 * Route one fan-out's candidates through the Selector: TRUST (exit 0),
 * TRUST_SPOT_CHECK (exit 10), or ESCALATE (exit 20) — same exit-code family as
 * `loop decide`, so shell pipelines can branch on the outcome directly.
 */
export class RouteCommand extends Command {
  static override paths = [['route']];

  file = Option.String({ required: false });
  category = Option.String('--category');
  threshold = Option.String('--threshold');
  trustSingleton = Option.Boolean('--trust-singleton', false);
  forced = Option.String('--forced');

  override async execute(): Promise<number> {
    const source = this.file ?? '-';
    const content =
      source === '-'
        ? await readStream(this.context.stdin as AsyncIterable<Buffer | string>)
        : await new NodeFileSystem().read(source);
    if (content === null) {
      this.context.stderr.write(`no candidates file ${source}\n`);
      return 2;
    }
    const input = parseInput(content);
    if (typeof input === 'string') {
      this.context.stderr.write(`route: ${input}\n`);
      return 2;
    }

    const threshold = this.threshold === undefined ? undefined : Number(this.threshold);
    if (
      threshold !== undefined &&
      !(Number.isFinite(threshold) && threshold > 0 && threshold < 1)
    ) {
      this.context.stderr.write('route: --threshold must be a number in (0, 1)\n');
      return 2;
    }
    const config: SelectorConfig = {
      trustThreshold: threshold ?? DEFAULT_SELECTOR_CONFIG.trustThreshold,
      trustSingleton: this.trustSingleton || DEFAULT_SELECTOR_CONFIG.trustSingleton,
      forcedEscalateCategories:
        this.forced === undefined
          ? DEFAULT_SELECTOR_CONFIG.forcedEscalateCategories
          : this.forced
              .split(',')
              .map((s) => s.trim())
              .filter((s) => s.length > 0),
    };

    const decision = route(input.candidates, config, this.category ?? input.category);
    this.context.stdout.write(`${JSON.stringify(decision)}\n`);
    switch (decision.outcome) {
      case 'TRUST':
        return 0;
      case 'TRUST_SPOT_CHECK':
        return 10;
      case 'ESCALATE':
        return 20;
    }
  }
}
