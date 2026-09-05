import { isBlank, splitSections, type Section } from './markdown.ts';

const REQUIRED = [
  'Problem',
  'Scope',
  'Approach',
  'Design Decisions',
  'Changes',
  'Code Structure',
  'UI/UX Specification',
  'Risks & Failure Modes',
  'Verification Plan',
  'Acceptance Criteria',
] as const;

const CODE_STRUCTURE_REQUIRED = [
  'Database Schema & Migrations',
  'Data Model & Persistence',
  'Domain / Class / Entity Model',
  'API & Wire Contracts',
  'Runtime & Service Flow',
  'Client State & Integration',
  'Compatibility, Security & Operations',
] as const;

const BULLET = /^\s*[-*]\s+\S/;
const PATH = /`[^`]*[/.][^`]*`|(?:^|\s)[\w./-]+\.[a-z]{1,5}(?:\s|$)/i;
const NOT_APPLICABLE = /^\s*not applicable\s*[—–-]\s*\S/i;

export const normalizeHeading = (heading: string) =>
  heading
    .replace(/[^a-z0-9 ]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

function byHeading(sections: Section[]): Map<string, Section> {
  return new Map(
    sections.map((section) => [normalizeHeading(section.heading), section]),
  );
}

function hasNotApplicableReason(section: Section): boolean {
  const first = section.body.find((line) => line.trim());
  return Boolean(first && NOT_APPLICABLE.test(first));
}

export function validatePlan(text: string): string[] {
  const sections = splitSections(text.split('\n'));
  const byName = byHeading(sections);
  const failures: string[] = [];

  for (const name of REQUIRED) {
    const section = byName.get(normalizeHeading(name));
    if (!section) {
      failures.push(`Missing required section: ## ${name}`);
      continue;
    }
    if (isBlank(section.body)) {
      failures.push(`Section is empty: ## ${name}`);
    }
  }

  const changes = byName.get(normalizeHeading('Changes'));
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

  const codeStructure = byName.get(normalizeHeading('Code Structure'));
  if (codeStructure && !isBlank(codeStructure.body)) {
    const nested = byHeading(splitSections(codeStructure.body, 3));
    for (const name of CODE_STRUCTURE_REQUIRED) {
      const section = nested.get(normalizeHeading(name));
      if (!section) {
        failures.push(`Missing required subsection: ### ${name}`);
      } else if (isBlank(section.body)) {
        failures.push(`Subsection is empty: ### ${name}`);
      }
    }
  }

  const ui = byName.get(normalizeHeading('UI/UX Specification'));
  if (ui && !isBlank(ui.body) && /^\s*not applicable\b/i.test(ui.body.find((line) => line.trim()) ?? '')) {
    if (!hasNotApplicableReason(ui)) {
      failures.push(
        '## UI/UX Specification must use `Not applicable — <reason>` when it does not apply.',
      );
    }
  }

  if (codeStructure) {
    for (const section of splitSections(codeStructure.body, 3)) {
      const first = section.body.find((line) => line.trim()) ?? '';
      if (/^\s*not applicable\b/i.test(first) && !hasNotApplicableReason(section)) {
        failures.push(
          `### ${section.heading} must use \`Not applicable — <reason>\` when it does not apply.`,
        );
      }
    }
  }

  const criteria = byName.get(normalizeHeading('Acceptance Criteria'));
  if (criteria && !isBlank(criteria.body)) {
    if (!criteria.body.some((line) => BULLET.test(line))) {
      failures.push(
        '## Acceptance Criteria must list at least one checkable bullet.',
      );
    }
  }

  const verification = byName.get(normalizeHeading('Verification Plan'));
  if (verification && !isBlank(verification.body)) {
    if (!verification.body.some((line) => BULLET.test(line))) {
      failures.push('## Verification Plan must list at least one checkable bullet.');
    }
  }

  return failures;
}
