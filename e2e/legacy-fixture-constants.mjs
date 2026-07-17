// Shared, side-effect-free constants for the pre-migration legacy-message
// backfill fixture. Kept separate from seed-legacy-message.mjs (which does
// the actual DB write and is only ever run directly via `node`, never
// imported) so the Playwright spec that asserts on this fixture can import
// just these values without pulling in DB/env side effects.

export const LEGACY_CHAT_ID = 'e2e-legacy-backfill-fixture';
export const LEGACY_PROSE_MARKER = 'legacy-backfill-prose-marker';
export const LEGACY_TOOL_MARKER = 'legacy-backfill-tool-only-marker';

export const LEGACY_CONTENT =
  `Answering with the ${LEGACY_PROSE_MARKER} in plain prose.\n\n` +
  '```yaawc:tool_call\n' +
  `{"id":"x","type":"file_search","status":"success","query":"${LEGACY_TOOL_MARKER}"}\n` +
  '```\n';
