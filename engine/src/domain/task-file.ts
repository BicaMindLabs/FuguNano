/** TASK file scaffold (bash `task`): an auditable record per parallel dispatch run. */
export type TaskPriority = 'P0' | 'P1' | 'P2';

export interface TaskRef {
  readonly id: string;
  readonly path: string;
}

/** Render a fresh TASK file body (parity with the bash template). */
export const renderTaskFile = (
  id: string,
  title: string,
  priority: TaskPriority,
  created: string,
): string =>
  [
    `# ${id}: ${title}`,
    'Status: IN_PROGRESS',
    `Priority: ${priority}`,
    `Created: ${created}`,
    'Completed: -',
    '',
    '## Requirements',
    title,
    '',
    '## Subtasks',
    '- [ ] (task1) — <scope> (Implementer: cc-xxx, file: ...)',
    '- [ ] Final Review (Reviewer: coder)',
    '',
    '## Output files',
    '- ...',
    '',
    '## Log',
    '',
  ].join('\n');
