import { describe, expect, it } from 'vitest';

import { isOk } from './result.js';
import {
  agentHasRole,
  agentPolicyLabel,
  agentsForRole,
  findAgentProfile,
  parseAgentRegistryJson,
  renderAgentRegistryTemplate,
  resolveAgentTarget,
} from './agent-registry.js';

const parseOk = (text: string) => {
  const result = parseAgentRegistryJson(text);
  expect(isOk(result)).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

const parseError = (text: string): string => {
  const result = parseAgentRegistryJson(text);
  expect(result.ok).toBe(false);
  return result.ok ? '' : result.error;
};

describe('parseAgentRegistryJson', () => {
  it('parses logical agents across multiple harnesses', () => {
    const registry = parseOk(
      JSON.stringify({
        agents: [
          {
            id: 'cc-deepseek',
            harness: 'fugue-cc',
            modelFamily: 'deepseek',
            roles: ['implementer', 'fixer', 'implementer'],
            canEditFiles: true,
            tags: ['backend', 'backend'],
          },
          {
            id: 'coder',
            harness: 'codex',
            target: 'gpt-5.5',
            modelFamily: 'openai',
            roles: ['reviewer'],
            reviewAllowed: true,
            workspace: 'review',
          },
          {
            id: 'agy-ui',
            harness: 'agy',
            target: 'default',
            modelFamily: 'gemini',
            roles: ['implementer'],
            workspace: 'code',
          },
        ],
      }),
    );

    const deepseek = findAgentProfile(registry, 'cc-deepseek');
    const coder = findAgentProfile(registry, 'coder');

    expect(deepseek && resolveAgentTarget(deepseek)).toBe('cc-deepseek');
    expect(deepseek && deepseek.roles).toEqual(['implementer', 'fixer']);
    expect(deepseek && deepseek.tags).toEqual(['backend']);
    expect(coder && resolveAgentTarget(coder)).toBe('gpt-5.5');
    expect(coder && agentHasRole(coder, 'reviewer')).toBe(true);
    expect(agentsForRole(registry, 'implementer').map((agent) => agent.id)).toEqual([
      'cc-deepseek',
      'agy-ui',
    ]);
  });

  it('treats omitted roles as legacy unrestricted profiles', () => {
    const registry = parseOk(
      JSON.stringify({
        agents: [{ id: 'opencode-kimi', harness: 'opencode', target: 'kimi/latest' }],
      }),
    );

    const profile = findAgentProfile(registry, 'opencode-kimi');
    expect(profile && agentHasRole(profile, 'implementer')).toBe(true);
    expect(profile && agentHasRole(profile, 'reviewer')).toBe(true);
  });

  it('treats an explicit empty roles array as no selectable roles', () => {
    const registry = parseOk(
      JSON.stringify({
        agents: [{ id: 'parked-agent', harness: 'codex', roles: [] }],
      }),
    );

    const profile = findAgentProfile(registry, 'parked-agent');
    expect(profile && agentHasRole(profile, 'implementer')).toBe(false);
    expect(profile && agentHasRole(profile, 'reviewer')).toBe(false);
  });

  it('renders a valid starter template', () => {
    const registry = parseAgentRegistryJson(renderAgentRegistryTemplate());
    expect(registry.ok).toBe(true);
    expect(registry.ok && findAgentProfile(registry.value, 'qwen-code')?.harness).toBe('agent-cli');
  });

  it('parses experimental agent-cli profiles for opt-in runtimes', () => {
    const registry = parseOk(
      JSON.stringify({
        agents: [
          {
            id: 'qwen-code',
            harness: 'agent-cli',
            target: 'default',
            modelFamily: 'qwen',
            roles: ['implementer'],
            tags: ['experimental'],
          },
        ],
      }),
    );

    const profile = findAgentProfile(registry, 'qwen-code');
    expect(profile && resolveAgentTarget(profile)).toBe('default');
    expect(profile && agentHasRole(profile, 'implementer')).toBe(true);
  });

  it('rejects duplicate agent ids', () => {
    expect(
      parseError(
        JSON.stringify({
          agents: [
            { id: 'coder', harness: 'codex' },
            { id: 'coder', harness: 'opencode' },
          ],
        }),
      ),
    ).toMatch(/duplicate agent/u);
  });

  it('rejects invalid harness and role values', () => {
    expect(parseError(JSON.stringify({ agents: [{ id: 'bad', harness: 'claude-code' }] }))).toMatch(
      /harness must be one of/u,
    );
    expect(
      parseError(
        JSON.stringify({ agents: [{ id: 'bad', harness: 'codex', roles: ['observer'] }] }),
      ),
    ).toMatch(/roles\[0\] must be one of/u);
  });

  it('rejects invalid JSON', () => {
    expect(parseError('{ nope')).toMatch(/invalid JSON/u);
  });

  it('keeps policy labels rich enough for family-level bans', () => {
    const registry = parseOk(
      JSON.stringify({
        agents: [
          {
            id: 'fast-review',
            harness: 'opencode',
            target: 'model/latest',
            modelFamily: 'gemini',
          },
        ],
      }),
    );

    const profile = findAgentProfile(registry, 'fast-review');
    expect(profile && agentPolicyLabel(profile)).toBe('gemini/model/latest/fast-review/opencode');
  });
});
