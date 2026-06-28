/**
 * Experience memory (Zleap): a completed task → a reusable, redacted method,
 * bucketed by workspace, recalled into context for future similar tasks.
 */
export interface Method {
  readonly workspace: string;
  readonly title: string;
  readonly slug: string;
  readonly created: number; // epoch seconds (bash `date +%s`)
  readonly sourceKind: ExperienceSourceKind;
  readonly sourceRef?: string;
  readonly trustKind: ExperienceTrustKind;
  readonly body: string;
}

export interface AddMethod {
  readonly workspace: string;
  readonly title: string;
  readonly sourceKind?: ExperienceSourceKind;
  readonly sourceRef?: string;
  readonly trustKind?: ExperienceTrustKind;
  readonly body: string;
}

export const EXPERIENCE_SOURCE_KINDS = ['manual', 'task'] as const;

export type ExperienceSourceKind = (typeof EXPERIENCE_SOURCE_KINDS)[number];

export const isExperienceSourceKind = (value: string): value is ExperienceSourceKind =>
  (EXPERIENCE_SOURCE_KINDS as readonly string[]).includes(value);

export const EXPERIENCE_TRUST_KINDS = ['trusted', 'untrusted'] as const;

export type ExperienceTrustKind = (typeof EXPERIENCE_TRUST_KINDS)[number];

export const isExperienceTrustKind = (value: string): value is ExperienceTrustKind =>
  (EXPERIENCE_TRUST_KINDS as readonly string[]).includes(value);

export const EXPERIENCE_TRUST_FILTERS = ['trusted', 'untrusted', 'all'] as const;

export type ExperienceTrustFilter = (typeof EXPERIENCE_TRUST_FILTERS)[number];

export const isExperienceTrustFilter = (value: string): value is ExperienceTrustFilter =>
  (EXPERIENCE_TRUST_FILTERS as readonly string[]).includes(value);

export const FAILURE_CAUSES = [
  'planning',
  'context',
  'retrieval',
  'tooling',
  'implementation',
  'verification',
  'integration',
  'runtime',
  'policy',
  'other',
] as const;

export type FailureCause = (typeof FAILURE_CAUSES)[number];

export const isFailureCause = (value: string): value is FailureCause =>
  (FAILURE_CAUSES as readonly string[]).includes(value);

const QUERY_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'into',
  'is',
  'it',
  'of',
  'on',
  'or',
  'should',
  'that',
  'the',
  'this',
  'to',
  'use',
  'with',
]);

export const experienceQueryTerms = (query: string | undefined): readonly string[] => {
  if (query === undefined) return [];
  const terms = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return [...new Set(terms.filter((term) => !QUERY_STOP_WORDS.has(term)))];
};

export const experienceMatchedTerms = (
  method: Pick<Method, 'title' | 'body'>,
  terms: readonly string[],
): readonly string[] => {
  const methodTerms = new Set(experienceQueryTerms(`${method.title}\n${method.body}`));
  return terms.filter((term) => methodTerms.has(term));
};

export const experienceScore = (
  method: Pick<Method, 'title' | 'body'>,
  terms: readonly string[],
): number => experienceMatchedTerms(method, terms).length;

export const experienceFailureCause = (method: Pick<Method, 'body'>): FailureCause | undefined => {
  const lines = method.body.split(/\r?\n/u);
  const index = lines.findIndex((line) => line === 'Failure cause:');
  const cause = index === -1 ? undefined : lines[index + 1]?.trim().toLowerCase();
  return cause !== undefined && isFailureCause(cause) ? cause : undefined;
};

export interface RecallMatchExplanation {
  readonly score: number;
  readonly matchedTerms: readonly string[];
  readonly sourceKind: ExperienceSourceKind;
  readonly sourceRef?: string;
  readonly trustKind: ExperienceTrustKind;
  readonly failureCause?: FailureCause;
  readonly minScore?: number;
  readonly sourceFilter?: ExperienceSourceKind;
  readonly sourceRefFilter?: string;
  readonly trustFilter?: ExperienceTrustFilter;
  readonly maxAgeSeconds?: number;
}

export const explainRecallMatch = (
  method: Pick<Method, 'title' | 'body'> &
    Partial<Pick<Method, 'sourceKind' | 'sourceRef' | 'trustKind'>>,
  options: RecallOptions = {},
): RecallMatchExplanation => {
  const terms = experienceQueryTerms(options.query);
  const matchedTerms = experienceMatchedTerms(method, terms);
  const failureCause = experienceFailureCause(method);
  const sourceKind = method.sourceKind ?? 'manual';
  const trustKind = method.trustKind ?? 'trusted';
  return {
    score: matchedTerms.length,
    matchedTerms,
    sourceKind,
    ...(method.sourceRef === undefined || method.sourceRef.length === 0
      ? {}
      : { sourceRef: method.sourceRef }),
    trustKind,
    ...(failureCause === undefined ? {} : { failureCause }),
    ...(options.minScore === undefined ? {} : { minScore: options.minScore }),
    ...(options.sourceKind === undefined ? {} : { sourceFilter: options.sourceKind }),
    ...(options.sourceRef === undefined ? {} : { sourceRefFilter: options.sourceRef }),
    ...(options.trust === undefined ? {} : { trustFilter: options.trust }),
    ...(options.maxAgeSeconds === undefined ? {} : { maxAgeSeconds: options.maxAgeSeconds }),
  };
};

export type ExperienceErrorKind = 'empty-body' | 'contains-secret';

export interface ExperienceError {
  readonly kind: ExperienceErrorKind;
  readonly detail: string;
}

export interface RecallOptions {
  readonly query?: string;
  readonly limit?: number;
  readonly failureCause?: FailureCause;
  readonly minScore?: number;
  readonly sourceKind?: ExperienceSourceKind;
  readonly sourceRef?: string;
  readonly trust?: ExperienceTrustFilter;
  readonly maxAgeSeconds?: number;
}
