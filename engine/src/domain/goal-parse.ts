import type { GoalSpec } from './goal.js';

/** First `^<key>: value` line, trimmed; '' if absent (bash `field`). */
const field = (lines: readonly string[], key: string): string => {
  const prefix = `${key}:`;
  for (const line of lines) {
    if (line.startsWith(prefix)) return line.slice(prefix.length).trim();
  }
  return '';
};

export const parseGoalSpec = (text: string): GoalSpec => {
  const lines = text.split(/\r?\n/u);
  const rounds = Number.parseInt(field(lines, 'rounds'), 10);
  return {
    outcome: field(lines, 'outcome'),
    gate: field(lines, 'gate'),
    rubric: field(lines, 'rubric'),
    rounds: Number.isFinite(rounds) && rounds > 0 ? rounds : 3,
    allocate: field(lines, 'allocate') === 'manual' ? 'manual' : 'auto',
  };
};

export const renderGoalTemplate = (): string =>
  [
    'outcome: <one-line goal>',
    'gate: <runnable acceptance command; met = exit 0>',
    'rubric: <focus areas for the reviewer>',
    'rounds: 3',
    'allocate: auto',
    '',
  ].join('\n');
