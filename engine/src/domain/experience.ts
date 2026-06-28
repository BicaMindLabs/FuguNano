/**
 * Experience memory (Zleap): a completed task → a reusable, redacted method,
 * bucketed by workspace, recalled into context for future similar tasks.
 */
export interface Method {
  readonly workspace: string;
  readonly title: string;
  readonly slug: string;
  readonly created: number; // epoch seconds (bash `date +%s`)
  readonly body: string;
}

export interface AddMethod {
  readonly workspace: string;
  readonly title: string;
  readonly body: string;
}

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
  readonly failureCause?: FailureCause;
}

export const explainRecallMatch = (
  method: Pick<Method, 'title' | 'body'>,
  options: RecallOptions = {},
): RecallMatchExplanation => {
  const terms = experienceQueryTerms(options.query);
  const matchedTerms = experienceMatchedTerms(method, terms);
  const failureCause = experienceFailureCause(method);
  return failureCause === undefined
    ? { score: matchedTerms.length, matchedTerms }
    : { score: matchedTerms.length, matchedTerms, failureCause };
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
}
