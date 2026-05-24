export const SKILL_NAME_REGEX = /^[a-z0-9][a-z0-9_:-]*$/;
export const SKILL_NAME_DESCRIPTION =
  'Lowercase letters, numbers, hyphens, underscores, or colons. Must start with a letter or number (e.g. "my-skill-name", "team:helper").';

export const MAX_SKILL_NAME_LEN = 64;
export const MAX_SKILL_DESC_LEN = 500;
export const MAX_SKILL_CONTENT_LEN = 65536;

export function isValidSkillName(name: string): boolean {
  return SKILL_NAME_REGEX.test(name);
}
