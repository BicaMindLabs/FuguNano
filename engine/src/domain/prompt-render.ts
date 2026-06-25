import type { AssembleInput, PromptBundle } from './prompt.js';

const DEFAULT_HISTORY =
  'last few conversation rounds + key execution trace (not the full transcript)';

/** Literally replace every `{{KEY}}` for keys present in `vars`; leave unknown `{{KEY}}` verbatim. */
export const renderTemplate = (
  template: string,
  vars: Readonly<Record<string, string>>,
): string => {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{{${key}}}`).join(value);
  }
  return out;
};

/** Build the layered context bundle (Zleap). IO (read workspace/system, recall experience) is the caller's. */
export const assembleContext = (input: AssembleInput): PromptBundle => {
  const { workspace } = input;
  const base: PromptBundle = {
    name: workspace.name,
    system: input.system,
    workspace: workspace.prompt,
    tools: workspace.tools,
    skills: workspace.skills,
    memory: workspace.memory,
    experience: input.experience ?? [],
    history: input.history ?? DEFAULT_HISTORY,
    models: workspace.models,
  };
  return input.task !== undefined ? { ...base, task: input.task } : base;
};

/**
 * Render a bundle to the layered text (parity with bash `fuguectl workspace context`).
 * Variable content is right-trimmed so sections are separated by exactly one blank
 * line regardless of trailing newlines in the source (e.g. `_system.md`).
 */
export const renderBundle = (bundle: PromptBundle): string => {
  const section = (header: string, body: string): string => {
    const trimmed = body.replace(/\s+$/u, '');
    return trimmed.length > 0 ? `${header}\n${trimmed}` : header;
  };

  const sections: string[] = [
    `## Context — workspace: ${bundle.name}`,
    section('### System Prompt', bundle.system),
    section('### Workspace Prompt', bundle.workspace),
  ];

  let tools = `### Tools\n${bundle.tools.join(' ')}  (only this station enabled, the rest not exposed)`;
  if (bundle.skills.length > 0) tools += `\nskills: ${bundle.skills.join(', ')}`;
  sections.push(tools);

  sections.push(
    `### Memory\nscope: ${bundle.memory.join(',')}  (only memory relevant to this scope, not the full archive)`,
  );

  if (bundle.experience.length > 0)
    sections.push(bundle.experience.join('\n').replace(/\s+$/u, ''));

  sections.push(section('### History', bundle.history));

  if (bundle.task !== undefined) sections.push(section('### Task', bundle.task));

  if (bundle.models.length > 0) sections.push(`> suggested model(bench): ${bundle.models}`);

  return `${sections.join('\n\n')}\n`;
};
