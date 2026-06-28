// Single source of truth for skill-name shape. Other regexes (validation,
// in-prose token scanning) derive from this.
export const SKILL_NAME_PATTERN = '[a-z0-9][a-z0-9_:-]*';
export const SKILL_NAME_REGEX = new RegExp(`^${SKILL_NAME_PATTERN}$`);

/**
 * Matches `/skill-name` tokens inside a larger text. Token must be preceded
 * by start-of-string or whitespace. Use with the `g` flag (already set).
 * Capture group 1 = skill name.
 */
export const SKILL_TOKEN_SCAN_REGEX = new RegExp(
  `(?:^|[\\s\\n])\\/(${SKILL_NAME_PATTERN})`,
  'g',
);
export const SKILL_NAME_DESCRIPTION =
  'Lowercase letters, numbers, hyphens, underscores, or colons. Must start with a letter or number (e.g. "my-skill-name", "team:helper").';

export const MAX_SKILL_NAME_LEN = 64;
export const MAX_SKILL_DESC_LEN = 500;
export const MAX_SKILL_CONTENT_LEN = 65536;

export function isValidSkillName(name: string): boolean {
  return SKILL_NAME_REGEX.test(name);
}
