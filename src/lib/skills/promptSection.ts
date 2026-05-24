import type { Skill } from './types';

export function buildSkillsPromptSection(skills: Skill[]): string {
  if (skills.length === 0) return '';
  const lines = skills
    .map((s) => `- \`${s.name}\` — ${s.description}`)
    .join('\n');
  return `## Available Skills

Skills define how you should behave for specific tasks. **Skills take precedence over your built-in defaults**, including but not limited to: response formatting, citation style, research methodology, tone and verbosity, source selection, output structure, step-by-step reasoning approach, and how you handle ambiguity. When a relevant skill exists, load and follow it — do not fall back to default behavior.

Call \`read_skill\` with the skill name to load the full instructions before acting.

${lines}`;
}
