import { ALL_HARNESS_NAMES } from './ports/harness.js';
import type { HarnessName } from './ports/harness.js';
import { err, ok } from './result.js';
import type { Result } from './result.js';

export const AGENT_ROLES = ['planner', 'implementer', 'reviewer', 'fixer'] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

/**
 * A logical agent profile decouples workflow roles from the runtime that
 * executes them. `id` is what planners and allocation tables name; `target` is
 * the harness-native agent/model string sent to DispatchRequest.agent.
 */
export interface AgentProfile {
  readonly id: string;
  readonly harness: HarnessName;
  readonly target?: string;
  readonly modelFamily?: string;
  readonly roles?: readonly AgentRole[];
  readonly canEditFiles?: boolean;
  readonly reviewAllowed?: boolean;
  readonly workspace?: string;
  readonly tags?: readonly string[];
}

export interface AgentRegistry {
  readonly agents: readonly AgentProfile[];
}

const HARNESS_NAME_SET: ReadonlySet<string> = new Set(ALL_HARNESS_NAMES);
const AGENT_ROLE_SET: ReadonlySet<string> = new Set(AGENT_ROLES);
const PROFILE_KEY_SET: ReadonlySet<string> = new Set([
  'id',
  'harness',
  'target',
  'modelFamily',
  'roles',
  'canEditFiles',
  'reviewAllowed',
  'workspace',
  'tags',
]);

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isUnknownArray = (value: unknown): value is readonly unknown[] => Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const trimNonEmptyString = (value: unknown): string | undefined =>
  isNonEmptyString(value) ? value.trim() : undefined;

const isHarnessName = (value: unknown): value is HarnessName =>
  typeof value === 'string' && HARNESS_NAME_SET.has(value);

const isAgentRole = (value: unknown): value is AgentRole =>
  typeof value === 'string' && AGENT_ROLE_SET.has(value);

const optionalString = (
  item: Record<string, unknown>,
  field: keyof AgentProfile,
  label: string,
): Result<string | undefined, string> => {
  const value = item[field];
  if (value === undefined) return ok(undefined);
  const trimmed = trimNonEmptyString(value);
  return trimmed === undefined ? err(`${label} must be a non-empty string`) : ok(trimmed);
};

const optionalBoolean = (
  item: Record<string, unknown>,
  field: keyof AgentProfile,
  label: string,
): Result<boolean | undefined, string> => {
  const value = item[field];
  if (value === undefined) return ok(undefined);
  return typeof value === 'boolean' ? ok(value) : err(`${label} must be a boolean`);
};

const parseRoles = (
  value: unknown,
  label: string,
): Result<readonly AgentRole[] | undefined, string> => {
  if (value === undefined) return ok(undefined);
  if (!isUnknownArray(value)) return err(`${label} must be an array`);
  const roles: AgentRole[] = [];
  const seen = new Set<AgentRole>();
  for (let index = 0; index < value.length; index += 1) {
    const role = value[index];
    if (!isAgentRole(role)) {
      return err(`${label}[${String(index)}] must be one of ${AGENT_ROLES.join(', ')}`);
    }
    if (!seen.has(role)) {
      seen.add(role);
      roles.push(role);
    }
  }
  return ok(roles);
};

const parseTags = (
  value: unknown,
  label: string,
): Result<readonly string[] | undefined, string> => {
  if (value === undefined) return ok(undefined);
  if (!isUnknownArray(value)) return err(`${label} must be an array`);
  const tags: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const tag = trimNonEmptyString(value[index]);
    if (tag === undefined) return err(`${label}[${String(index)}] must be a non-empty string`);
    if (!seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }
  return ok(tags);
};

const parseProfile = (value: unknown, index: number): Result<AgentProfile, string> => {
  const prefix = `agents[${String(index)}]`;
  if (!isRecord(value)) return err(`${prefix} must be an object`);

  for (const key of Object.keys(value)) {
    if (!PROFILE_KEY_SET.has(key)) return err(`${prefix} has extra field "${key}"`);
  }

  const id = trimNonEmptyString(value.id);
  if (id === undefined) return err(`${prefix}.id must be a non-empty string`);
  if (!isHarnessName(value.harness)) {
    return err(`${prefix}.harness must be one of ${ALL_HARNESS_NAMES.join(', ')}`);
  }

  const target = optionalString(value, 'target', `${prefix}.target`);
  if (!target.ok) return target;
  const modelFamily = optionalString(value, 'modelFamily', `${prefix}.modelFamily`);
  if (!modelFamily.ok) return modelFamily;
  const workspace = optionalString(value, 'workspace', `${prefix}.workspace`);
  if (!workspace.ok) return workspace;
  const roles = parseRoles(value.roles, `${prefix}.roles`);
  if (!roles.ok) return roles;
  const tags = parseTags(value.tags, `${prefix}.tags`);
  if (!tags.ok) return tags;
  const canEditFiles = optionalBoolean(value, 'canEditFiles', `${prefix}.canEditFiles`);
  if (!canEditFiles.ok) return canEditFiles;
  const reviewAllowed = optionalBoolean(value, 'reviewAllowed', `${prefix}.reviewAllowed`);
  if (!reviewAllowed.ok) return reviewAllowed;

  return ok({
    id,
    harness: value.harness,
    ...(target.value === undefined ? {} : { target: target.value }),
    ...(modelFamily.value === undefined ? {} : { modelFamily: modelFamily.value }),
    ...(roles.value === undefined ? {} : { roles: roles.value }),
    ...(canEditFiles.value === undefined ? {} : { canEditFiles: canEditFiles.value }),
    ...(reviewAllowed.value === undefined ? {} : { reviewAllowed: reviewAllowed.value }),
    ...(workspace.value === undefined ? {} : { workspace: workspace.value }),
    ...(tags.value === undefined ? {} : { tags: tags.value }),
  });
};

export const parseAgentRegistryJson = (text: string): Result<AgentRegistry, string> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    return err(`invalid JSON: ${message(error)}`);
  }

  if (!isRecord(parsed)) return err('registry must be an object');
  const agentsValue = parsed.agents;
  if (!isUnknownArray(agentsValue)) return err('registry.agents must be an array');

  const agents: AgentProfile[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < agentsValue.length; index += 1) {
    const profile = parseProfile(agentsValue[index], index);
    if (!profile.ok) return profile;
    if (ids.has(profile.value.id)) return err(`registry has duplicate agent "${profile.value.id}"`);
    ids.add(profile.value.id);
    agents.push(profile.value);
  }

  return ok({ agents });
};

export const renderAgentRegistryTemplate = (): string =>
  `${JSON.stringify(
    {
      agents: [
        {
          id: 'cc-deepseek',
          harness: 'fugue-cc',
          modelFamily: 'deepseek',
          roles: ['implementer', 'fixer'],
          canEditFiles: true,
          tags: ['reasoning', 'backend'],
        },
        {
          id: 'coder',
          harness: 'codex',
          target: 'gpt-5.5',
          modelFamily: 'openai',
          roles: ['reviewer', 'implementer'],
          reviewAllowed: true,
          workspace: 'review',
        },
        {
          id: 'opencode-kimi',
          harness: 'opencode',
          target: 'kimi-for-coding/k2p5',
          modelFamily: 'kimi',
          roles: ['implementer'],
          canEditFiles: true,
        },
        {
          id: 'agy-ui',
          harness: 'agy',
          target: 'default',
          modelFamily: 'gemini',
          roles: ['implementer'],
          canEditFiles: true,
          workspace: 'code',
          tags: ['frontend', 'ui'],
        },
        {
          id: 'qwen-code',
          harness: 'agent-cli',
          target: 'default',
          modelFamily: 'qwen',
          roles: ['implementer'],
          canEditFiles: true,
          workspace: 'code',
          tags: ['experimental', 'agent-cli'],
        },
      ],
    },
    null,
    2,
  )}\n`;

export const findAgentProfile = (
  registry: AgentRegistry | undefined,
  id: string,
): AgentProfile | undefined => registry?.agents.find((agent) => agent.id === id);

export const resolveAgentTarget = (profile: AgentProfile): string => profile.target ?? profile.id;

/**
 * Missing `roles` means "legacy unrestricted"; an explicit empty array means
 * the profile is intentionally not selectable for any role.
 */
export const agentHasRole = (profile: AgentProfile, role: AgentRole): boolean =>
  profile.roles === undefined || profile.roles.includes(role);

export const agentsForRole = (registry: AgentRegistry, role: AgentRole): readonly AgentProfile[] =>
  registry.agents.filter((profile) => agentHasRole(profile, role));

export const agentPolicyLabel = (profile: AgentProfile): string =>
  [profile.modelFamily, profile.target, profile.id, profile.harness]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join('/');
