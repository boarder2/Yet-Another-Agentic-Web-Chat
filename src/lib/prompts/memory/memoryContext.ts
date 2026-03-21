import { ScoredMemory } from '@/lib/utils/memoryRetrieval';

const TOKEN_BUDGET = 800;
const CHARS_PER_TOKEN = 4;
const MAX_CHARS = TOKEN_BUDGET * CHARS_PER_TOKEN;

const PREAMBLE = `## Remembered Context
- Use this context only when it clearly improves answer quality.
- Do not repeat these facts back unless the user explicitly asks.
- If the user's latest message contradicts a memory, follow the user's latest statement.
- If persona instructions conflict with a memory, follow the persona instructions.`;

export function buildMemorySection(scoredMemories: ScoredMemory[]): string {
  if (!scoredMemories || scoredMemories.length === 0) {
    return '';
  }

  let content = PREAMBLE + '\n';
  let currentChars = content.length;

  for (const memory of scoredMemories) {
    const line = `- ${memory.content}\n`;
    if (currentChars + line.length > MAX_CHARS) {
      break;
    }
    content += line;
    currentChars += line.length;
  }

  return content;
}
