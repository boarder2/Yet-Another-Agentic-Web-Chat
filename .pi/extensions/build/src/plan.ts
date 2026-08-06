import { isBlank, splitSections } from './markdown.ts';

const REQUIRED = [
  'Problem',
  'Scope',
  'Approach',
  'Changes',
  'Acceptance Criteria',
] as const;

const BULLET = /^\s*[-*]\s+\S/;
// A backticked path, or a bare one with a slash or a file extension.
const PATH = /`[^`]*[/.][^`]*`|(?:^|\s)[\w./-]+\.[a-z]{1,5}(?:\s|$)/i;

const normalize = (heading: string) =>
  heading
    .replace(/[^a-z0-9 ]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

export function validatePlan(text: string): string[] {
  const sections = splitSections(text.split('\n'));
  const byName = new Map(
    sections.map((section) => [normalize(section.heading), section]),
  );
  const failures: string[] = [];

  for (const name of REQUIRED) {
    const section = byName.get(normalize(name));
    if (!section) {
      failures.push(`Missing required section: ## ${name}`);
      continue;
    }
    if (isBlank(section.body)) {
      failures.push(`Section is empty: ## ${name}`);
    }
  }

  const changes = byName.get(normalize('Changes'));
  if (changes && !isBlank(changes.body)) {
    const listed = changes.body.filter(
      (line) => BULLET.test(line) && PATH.test(line),
    );
    if (listed.length === 0) {
      failures.push(
        '## Changes must list at least one file, as a bullet naming a path.',
      );
    }
  }

  const criteria = byName.get(normalize('Acceptance Criteria'));
  if (criteria && !isBlank(criteria.body)) {
    if (!criteria.body.some((line) => BULLET.test(line))) {
      failures.push(
        '## Acceptance Criteria must list at least one checkable bullet.',
      );
    }
  }

  return failures;
}
