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

/**
 * Field-shape check shared by create and update. Only defined fields are
 * checked, so an update may pass any subset. Returns the first problem found,
 * or null when the fields are acceptable.
 */
export function validateSkillFields(fields: {
  name?: string;
  description?: string;
  content?: string;
}): { message: string; extra?: Record<string, unknown> } | null {
  const { name, description, content } = fields;
  if (name !== undefined) {
    if (!isValidSkillName(name))
      return { message: `name must match ${SKILL_NAME_PATTERN}` };
    if (name.length > MAX_SKILL_NAME_LEN)
      return {
        message: 'name too long',
        extra: { maxLength: MAX_SKILL_NAME_LEN },
      };
  }
  if (description !== undefined && description.length > MAX_SKILL_DESC_LEN)
    return {
      message: 'description too long',
      extra: { maxLength: MAX_SKILL_DESC_LEN },
    };
  if (content !== undefined && content.length > MAX_SKILL_CONTENT_LEN)
    return {
      message: 'content too long',
      extra: { maxLength: MAX_SKILL_CONTENT_LEN },
    };
  return null;
}
