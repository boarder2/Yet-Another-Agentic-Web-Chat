import { z } from 'zod';
import { defineTool } from '@/lib/tools/defineTool';
import { emitStreamEvent } from '@/lib/streaming/events';
import {
  createArtifact,
  editArtifact,
  readArtifact,
  type ArtifactScope,
} from '@/lib/artifacts/service';
import type { ToolContext } from '@/lib/tools/toolContext';

/**
 * The contract the agent must satisfy for the artifact to work at all: the
 * sandbox grants no network, so anything not inlined simply never loads.
 */
const SELF_CONTAINED_CONTRACT = [
  'The artifact must be completely self-contained: a full HTML document with all CSS in <style> and all JavaScript in <script>, inline.',
  'It is rendered under a strict Content-Security-Policy that blocks every network request — external scripts, stylesheets, fonts, images, fetch/XHR/WebSocket all fail.',
  'Never reference a CDN or any URL. Embed images and fonts as data: URIs.',
].join(' ');

/**
 * Every artifact tool needs a chat to own the row and the turn's assistant
 * message to anchor the version — anchoring to the user message instead would
 * survive a regenerate that discards the tool call that wrote it.
 */
function requireScope(
  context: ToolContext,
):
  | { ok: true; scope: ArtifactScope; messageId: string }
  | { ok: false; error: string } {
  if (context.isPrivate) {
    return {
      ok: false,
      error:
        'Error: artifacts are unavailable in private chats, which keep nothing on disk. Answer in the conversation instead.',
    };
  }
  if (!context.chatId || !context.assistantMessageId) {
    return {
      ok: false,
      error:
        'Error: artifacts require an interactive chat session. They are unavailable in subagents and background runs.',
    };
  }
  return {
    ok: true,
    scope: {
      chatId: context.chatId,
      workspaceId: context.workspaceId ?? null,
    },
    messageId: context.assistantMessageId,
  };
}

export const createArtifactTool = defineTool(
  async (
    input: { title: string; content: string },
    runtime,
  ): Promise<string> => {
    const gate = requireScope(runtime.context);
    if (!gate.ok) return gate.error;

    const { artifactId, version } = createArtifact(
      gate.scope,
      gate.messageId,
      input.title,
      input.content,
    );

    emitStreamEvent(runtime.context.emitter, {
      type: 'artifact_saved',
      data: { artifactId, title: input.title, version, action: 'create' },
    });

    return JSON.stringify({
      artifactId,
      version,
      note: 'The artifact is now open beside the conversation for the user. Use this artifactId with edit_artifact to refine it — do not repeat its content in your reply; summarize what you made instead.',
    });
  },
  {
    name: 'create_artifact',
    description: `Create a rich, self-contained HTML page that renders beside the conversation — an interactive report, dashboard, visualization, or reference page the user will keep and iterate on. ${SELF_CONTAINED_CONTRACT} Inline JavaScript, CSS, SVG and canvas all work, so build genuinely interactive pages. Use this for substantial deliverables, not for ordinary answers, which belong in your reply. Returns an artifactId; refine the artifact with edit_artifact rather than recreating it.`,
    schema: z.object({
      title: z
        .string()
        .describe('Short human-readable title, shown in the viewer header.'),
      content: z
        .string()
        .describe('The complete HTML document, starting with <!doctype html>.'),
    }),
  },
);

export const editArtifactTool = defineTool(
  async (
    input: { artifactId: string; oldStr: string; newStr: string },
    runtime,
  ): Promise<string> => {
    const gate = requireScope(runtime.context);
    if (!gate.ok) return gate.error;

    const result = editArtifact(
      input.artifactId,
      gate.scope,
      gate.messageId,
      input.oldStr,
      input.newStr,
    );
    if (!result.ok) return `Error: ${result.message}`;

    emitStreamEvent(runtime.context.emitter, {
      type: 'artifact_saved',
      data: {
        artifactId: input.artifactId,
        title: result.title,
        version: result.version,
        action: 'edit',
      },
    });

    return JSON.stringify({
      artifactId: input.artifactId,
      version: result.version,
      note: 'Edit applied and shown to the user.',
    });
  },
  {
    name: 'edit_artifact',
    description: `Replace an exact string in an existing artifact, saving the result as a new version. oldStr must appear exactly once in the current content — include surrounding context to disambiguate. Prefer several targeted edits over rewriting the whole artifact. If you are not certain of the current content (a resumed chat, after compaction, or after a failed edit), call read_artifact first and copy oldStr from what it returns. ${SELF_CONTAINED_CONTRACT}`,
    schema: z.object({
      artifactId: z
        .string()
        .describe('The id returned by create_artifact or read_artifact.'),
      oldStr: z
        .string()
        .describe(
          'Exact text to replace, copied verbatim from the current content, including whitespace.',
        ),
      newStr: z.string().describe('Replacement text. Empty string deletes.'),
    }),
  },
);

export const readArtifactTool = defineTool(
  async (
    input: { artifactId: string; version?: number },
    runtime,
  ): Promise<string> => {
    const gate = requireScope(runtime.context);
    if (!gate.ok) return gate.error;

    // `readArtifact` applies the scope itself, so an artifact belonging to
    // another chat or workspace is indistinguishable from a missing one and the
    // agent learns nothing about artifacts it cannot reach.
    const result = readArtifact(input.artifactId, gate.scope, input.version);
    if (!result.ok) {
      if (result.reason === 'no_such_version') {
        return `Error: artifact "${input.artifactId}" has versions 1-${result.latestVersion}; version ${input.version} does not exist.`;
      }
      return `Error: no artifact with id "${input.artifactId}" is available here.`;
    }

    return JSON.stringify({
      artifactId: result.id,
      title: result.title,
      version: result.version,
      content: result.content,
    });
  },
  {
    name: 'read_artifact',
    description:
      "Return an artifact's title, version number, and full content. Call this before edit_artifact whenever the current content is not reliably in your context — a resumed conversation, after compaction, after an edit failed to match, or any time the artifact belongs to a workspace, where another conversation may have changed it since. Reads the current version unless `version` is given; versions run 1..N with no gaps. Note that edit_artifact always writes against the current version, so an older version can be consulted but not restored by editing.",
    schema: z.object({
      artifactId: z.string().describe('The artifact to read.'),
      version: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('Version to read. Defaults to the current version.'),
    }),
  },
);

export const artifactTools = [
  createArtifactTool,
  editArtifactTool,
  readArtifactTool,
];

/** Tool names gated out of private chats, which must leave nothing on disk. */
export const ARTIFACT_TOOL_NAMES = artifactTools.map((t) => t.name);
