/**
 * Artifact mentions: `@[Title](artifact:<id>)`.
 *
 * Deliberately ordinary markdown — the composer inserts it, the renderer picks
 * it up from an `a` override keyed on the `artifact:` href, and the server
 * scans the persisted message text for it. Nothing else records that a chat
 * references an artifact, so the transcript stays the single source of truth:
 * rewinding past a mention removes the reference along with the message.
 */

const UUID =
  '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

export const ARTIFACT_HREF_PREFIX = 'artifact:';

/** Matches the link tail of a mention. Use with the `g` flag (already set). */
export const ARTIFACT_MENTION_SCAN_REGEX = new RegExp(
  `\\]\\(${ARTIFACT_HREF_PREFIX}(${UUID})\\)`,
  'g',
);

const ARTIFACT_HREF_REGEX = new RegExp(`^${ARTIFACT_HREF_PREFIX}(${UUID})$`);

/**
 * The id an `href` addresses, or null when it isn't a mention. Ids are matched
 * against the uuid shape rather than accepted wholesale, so a hand-written
 * `artifact:` link can't smuggle anything else into the renderer.
 */
export function parseArtifactHref(href: string): string | null {
  return ARTIFACT_HREF_REGEX.exec(href)?.[1] ?? null;
}

/** Brackets would end the label early, so they're escaped rather than dropped. */
const escapeLabel = (title: string) => title.replace(/([[\]\\])/g, '\\$1');

/** The token the composer inserts. */
export function buildArtifactMention(id: string, title: string): string {
  return `@[${escapeLabel(title)}](${ARTIFACT_HREF_PREFIX}${id})`;
}

/** Every distinct artifact id mentioned in `text`, in first-appearance order. */
export function scanArtifactMentions(text: string): string[] {
  const ids = new Set<string>();
  for (const m of text.matchAll(ARTIFACT_MENTION_SCAN_REGEX)) ids.add(m[1]);
  return [...ids];
}
