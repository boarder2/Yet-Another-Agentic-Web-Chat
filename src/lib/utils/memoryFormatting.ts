import { formatTimeDifference } from '@/lib/utils';

export type MemoryListItem = {
  id: string;
  content: string;
  category: string | null;
  accessCount: number;
  lastAccessedAt: Date | null;
};

export function formatMemoriesList(
  allMemories: MemoryListItem[],
  now: Date = new Date(),
): string {
  if (allMemories.length === 0) {
    return 'No memories stored yet.';
  }

  const grouped = new Map<string, MemoryListItem[]>();
  for (const memory of allMemories) {
    const cat = memory.category || 'Uncategorized';
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(memory);
  }

  let result = `You have ${allMemories.length} stored memories:\n\n`;
  for (const [category, items] of grouped) {
    result += `**${category}**:\n`;
    for (const item of items) {
      const usage =
        item.accessCount > 0 && item.lastAccessedAt
          ? `, used ${item.accessCount}x, last used ${formatTimeDifference(now, item.lastAccessedAt)} ago`
          : ', never used';
      result += `- [id: ${item.id}] ${item.content}${usage}\n`;
    }
    result += '\n';
  }

  return result;
}
