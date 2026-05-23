import type { Skill } from './types';

export function buildSkillsPromptSection(skills: Skill[]): string {
  if (skills.length === 0) return '';
  const lines = skills
    .map((s) => `- \`${s.name}\` — ${s.description}`)
    .join('\n');
  return `## Available Skills\nSkills provide on-demand instructions. Call \`read_skill\` with the skill name to load the full body before acting.\n${lines}`;
}
