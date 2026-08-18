import { describe, expect, it } from 'vitest';
import { buildInvokedSkillsContext } from './promptSection';
import type { Skill } from './types';

const skills: Skill[] = [
  {
    source: 'user',
    name: 'grilling',
    description: 'Stress-test an idea.',
    content: 'Ask the whole frontier, then wait.',
    disableModelInvocation: false,
  },
  {
    source: 'user',
    name: 'other',
    description: 'Unrelated.',
    content: 'Do something else.',
    disableModelInvocation: false,
  },
];

describe('buildInvokedSkillsContext', () => {
  it('injects only explicitly invoked skill bodies as mandatory instructions', () => {
    const context = buildInvokedSkillsContext(skills, new Set(['grilling']));

    expect(context).toContain('instructions are mandatory');
    expect(context).toContain('<skill name="grilling">');
    expect(context).toContain('Ask the whole frontier, then wait.');
    expect(context).not.toContain('Do something else.');
  });

  it('returns no context when no resolved skill was invoked', () => {
    expect(buildInvokedSkillsContext(skills, new Set(['missing']))).toBe('');
  });

  it('keeps skill content inside CDATA', () => {
    const context = buildInvokedSkillsContext(
      [{ ...skills[0], content: 'before ]]> after' }],
      new Set(['grilling']),
    );

    expect(context).toContain('before ]]]]><![CDATA[> after');
  });
});
