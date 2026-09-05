import { createHash } from 'node:crypto';
import { isBlank, splitSections, type Section } from './markdown.ts';
import { normalizeHeading } from './plan.ts';

export interface TaskItem {
  line: number;
  checked: boolean;
  text: string;
}

export interface TaskChunk {
  id: string;
  number: number;
  title: string;
  headingLine: number;
  items: TaskItem[];
  implementationContract: string[];
  verification: string[];
  complete: boolean;
  overridden: boolean;
}

export interface TaskDocument {
  chunks: TaskChunk[];
}

const CHUNK_HEADING = /^chunk\s+(\d+)\s*(?:[—–:-]\s*(.*))?$/i;
const CHECKBOX = /^(\s*[-*]\s+)\[( |x|X)\]\s?(.*)$/;
const OVERRIDE = /\(override:\s*(.*?)\)\s*$/;
const PATH = /`[^`]*[/.][^`]*`|(?:^|\s)[\w./-]+\.[a-z]{1,5}(?:\s|$)/i;

function nestedSection(section: Section, heading: string): Section | undefined {
  return splitSections(section.body, 3).find(
    (candidate) => normalizeHeading(candidate.heading) === normalizeHeading(heading),
  );
}

export function parseTasks(text: string): TaskDocument {
  const lines = text.split('\n');
  const chunks: TaskChunk[] = [];

  for (const section of splitSections(lines)) {
    const match = CHUNK_HEADING.exec(section.heading.trim());
    if (!match) continue;

    const items: TaskItem[] = [];
    section.body.forEach((line, offset) => {
      const box = CHECKBOX.exec(line);
      if (box) {
        items.push({
          line: section.line + 1 + offset,
          checked: box[2].toLowerCase() === 'x',
          text: box[3].trim(),
        });
      }
    });

    const number = Number(match[1]);
    chunks.push({
      id: `chunk-${number}`,
      number,
      title: (match[2] ?? '').replace(OVERRIDE, '').trim(),
      headingLine: section.line,
      items,
      implementationContract:
        nestedSection(section, 'Implementation Contract')?.body ?? [],
      verification: nestedSection(section, 'Verification')?.body ?? [],
      complete: items.length > 0 && items.every((item) => item.checked),
      overridden: OVERRIDE.test(section.heading),
    });
  }

  return { chunks };
}

export function validateTasks(text: string): string[] {
  const { chunks } = parseTasks(text);
  const failures: string[] = [];

  if (chunks.length === 0) {
    failures.push(
      'No chunks found. Each chunk needs a `## Chunk <n> — <name>` heading.',
    );
  }

  for (const chunk of chunks) {
    if (!chunk.title) {
      failures.push(`Chunk ${chunk.number} needs a non-empty title after its separator.`);
    }
    if (chunk.overridden) {
      failures.push(`Chunk ${chunk.number} contains an override marker. Overrides are recorded only by the harness.`);
    }
    if (chunk.items.length === 0) {
      failures.push(
        `Chunk ${chunk.number} has no checklist items. Add at least one \`- [ ]\` line.`,
      );
    }
    if (chunk.items.some((item) => item.checked)) {
      failures.push(`Chunk ${chunk.number} contains pre-checked work. Every submitted item must start as \`- [ ]\`.`);
    }
    if (isBlank(chunk.implementationContract)) {
      failures.push(`Chunk ${chunk.number} needs a non-empty \`### Implementation Contract\` subsection.`);
    } else if (!chunk.implementationContract.some((line) => PATH.test(line))) {
      failures.push(`Chunk ${chunk.number} implementation contract must name at least one file path.`);
    }
    if (isBlank(chunk.verification)) {
      failures.push(`Chunk ${chunk.number} needs a non-empty \`### Verification\` subsection.`);
    } else if (!chunk.verification.some((line) => CHECKBOX.test(line))) {
      failures.push(`Chunk ${chunk.number} verification must contain at least one \`- [ ]\` check.`);
    }
  }

  const numbers = chunks.map((chunk) => chunk.number);
  const gapped = numbers.some(
    (number, index) => index > 0 && number !== numbers[index - 1] + 1,
  );
  if (gapped) {
    failures.push(
      `Chunks must be numbered consecutively in order; found ${numbers.join(', ')}.`,
    );
  }

  return failures;
}

export function nextChunk(doc: TaskDocument): TaskChunk | null {
  return doc.chunks.find((chunk) => !chunk.complete) ?? null;
}

export function hashContent(text: string): string {
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

export interface CompleteOptions {
  override?: string;
}

export function completeChunk(
  text: string,
  id: string,
  options: CompleteOptions = {},
): string {
  const doc = parseTasks(text);
  const chunk = doc.chunks.find((candidate) => candidate.id === id);
  if (!chunk) throw new Error(`Unknown chunk: ${id}`);

  const lines = text.split('\n');
  for (const item of chunk.items) {
    lines[item.line] = lines[item.line].replace(CHECKBOX, '$1[x] $3');
  }

  if (options.override !== undefined) {
    const reason = options.override.replace(/\s+/g, ' ').trim();
    lines[chunk.headingLine] =
      `${lines[chunk.headingLine].replace(OVERRIDE, '').trimEnd()} (override: ${reason})`;
  }

  return lines.join('\n');
}
