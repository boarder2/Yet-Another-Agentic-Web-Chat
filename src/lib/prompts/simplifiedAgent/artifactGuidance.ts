import type { ArtifactSummary } from '@/lib/artifacts/service';
import { formatTimeDifference } from '@/lib/utils';

/**
 * Artifact guidance injected into agent prompts for focus modes that include
 * the artifact tools. Withheld in private chats, where the tools are gated out.
 */
export const artifactGuidance = `## Artifacts

\`create_artifact\` publishes a self-contained HTML page that opens in a panel beside the conversation. Use it for substantial deliverables the user will keep, revisit, or interact with — a research report, a comparison matrix, a data dashboard, an interactive explainer, a reference page. Do NOT use it for ordinary answers, short summaries, or anything that reads fine as a few paragraphs; those belong in your reply.

**Hard constraint — the artifact must be entirely self-contained.** It renders under a Content-Security-Policy that blocks every network request, so anything not inlined simply never loads:
- All CSS in \`<style>\`, all JavaScript in \`<script>\`, inline in the page.
- No CDN links, no external stylesheets, fonts, or scripts. No \`fetch\`, XHR, or WebSocket — there is no network.
- Images and fonts must be \`data:\` URIs. Prefer inline SVG, which costs nothing.
- Everything else works: interactive JS, CSS animation, canvas, SVG. Build real interactivity rather than a static page.

**Iterating:** \`create_artifact\` returns an \`artifactId\`. Refine the artifact with \`edit_artifact\` (exact-match string replacement, one occurrence) — several targeted edits, not a full rewrite. Each successful write is a new version the user can switch between.

**In a workspace**, an artifact you create belongs to the workspace rather than to this conversation: it outlives the chat, any of the workspace's chats can edit it, and the user can point a later conversation at it. Treat it as a durable deliverable, not a scratch answer.

**Before editing**, call \`read_artifact\` whenever the current content is not reliably in your context — a resumed conversation, after compaction, or after an edit failed to match. Copy \`oldStr\` verbatim from what it returns. It reads the current version by default; pass \`version\` to read an earlier one.

**In your reply**, don't paste the artifact's contents back. Say what you built and what's in it; the user is already looking at it.`;

/**
 * Roster of the artifacts this chat can address — the ones it created plus the
 * ones the user mentioned — so ids stay usable once the tool results that
 * carried them have aged out of context. Rendered only when there are any,
 * which is also the only time its do-not-duplicate rule means anything. `now`
 * is a parameter so the relative timestamps are testable.
 */
export function buildArtifactRoster(
  artifacts: ArtifactSummary[],
  now: Date,
): string {
  if (artifacts.length === 0) return '';

  const entries = artifacts
    .map(
      (a) =>
        `- \`${a.id}\` — "${a.title}"${a.workspaceId ? ' (workspace artifact)' : ''}\n  v${a.latestVersion}, updated ${formatTimeDifference(now, a.updatedAt)} ago`,
    )
    .join('\n');

  const shared = artifacts.some((a) => a.workspaceId)
    ? ' A workspace artifact is shared across the workspace and may have been changed by another conversation since you last saw it, so `read_artifact` before editing rather than trusting your context.'
    : '';

  return `\n\n## Artifacts available in this chat\n\n${entries}\n\nThese already exist. To change one, use \`edit_artifact\` with its id — do not call \`create_artifact\` for an artifact listed here. Versions run 1..N with no gaps; \`read_artifact\` accepts any of them.${shared}`;
}
