import type { Skill } from './types';

const escapeForCdata = (value: string): string =>
  value.replace(/]]>/g, ']]]]><![CDATA[>');

export function buildInvokedSkillsContext(
  skills: Skill[],
  invokedNames: ReadonlySet<string>,
): string {
  const invoked = skills.filter((skill) => invokedNames.has(skill.name));
  if (invoked.length === 0) return '';

  const bodies = invoked
    .map(
      (skill) =>
        `<skill name="${skill.name}"><![CDATA[\n${escapeForCdata(skill.content)}\n]]></skill>`,
    )
    .join('\n');

  return `<invoked_skills>
The user explicitly invoked these skills for this turn. Their instructions are mandatory; apply them before acting on the request.
${bodies}
</invoked_skills>`;
}

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
