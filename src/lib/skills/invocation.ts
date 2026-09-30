import { getByName } from '@/lib/skills/resolve';
import { SKILL_TOKEN_SCAN_REGEX } from '@/lib/skills/validation';
import type { Skill } from '@/lib/skills/types';
import { persistToolContextRow } from '@/lib/utils/persistToolContext';

/** Skills a user message invokes: UI hints plus `/name` tokens that resolve. */
export function findInvokedSkillNames(
  skills: Skill[],
  content: string,
  hinted: Iterable<string> = [],
): Set<string> {
  const names = new Set(hinted);
  for (const m of content.matchAll(SKILL_TOKEN_SCAN_REGEX)) {
    if (getByName(skills, m[1])) names.add(m[1]);
  }
  return names;
}

/**
 * Persist user-invoked skill bodies as system rows on `parentMessageId`, so
 * later turns replay them through buildHistoryFromDb.
 */
export async function persistInvokedSkills(params: {
  chatId: string;
  parentMessageId: string;
  skills: Skill[];
  names: Iterable<string>;
}): Promise<void> {
  for (const skillName of params.names) {
    const skill = getByName(params.skills, skillName);
    if (!skill) continue;
    try {
      await persistToolContextRow({
        chatId: params.chatId,
        parentMessageId: params.parentMessageId,
        kind: 'skill_invocation',
        invoker: 'user',
        body: `[Skill "${skillName}" invoked by user]\n${skill.content}`,
        metadataExtras: { skillName },
      });
    } catch (err) {
      console.warn(
        `[skills] Failed to persist user-invoked skill "${skillName}":`,
        err,
      );
    }
  }
}
