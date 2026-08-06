import { createHash } from 'node:crypto';
import { splitSections } from './markdown.ts';

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
  complete: boolean;
  overridden: boolean;
}

export interface TaskDocument {
  chunks: TaskChunk[];
}

// `## Chunk 3 — name`, with an em dash, hyphen, or colon separator.
const CHUNK_HEADING = /^chunk\s+(\d+)\s*(?:[—–:-]\s*(.*))?$/i;
const CHECKBOX = /^(\s*[-*]\s+)\[( |x|X)\]\s?(.*)$/;
const OVERRIDE = /\(override:\s*(.*?)\)\s*$/;

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

  const empty = chunks.filter((chunk) => chunk.items.length === 0);
  for (const chunk of empty) {
    failures.push(
      `Chunk ${chunk.number} has no checklist items. Add at least one \`- [ ]\` line.`,
    );
  }

  // Consecutive and ascending, but free to start at 0 so a spike can be chunk 0.
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

// Rewrites only the chunk's own lines, so everything else survives byte-for-byte.
export function completeChunk(
  text: string,
  id: string,
  options: CompleteOptions = {},
): string {
  const doc = parseTasks(text);
  const chunk = doc.chunks.find((candidate) => candidate.id === id);
  if (!chunk) {
    throw new Error(`Unknown chunk: ${id}`);
  }

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
