import { Document } from '@langchain/core/documents';
import { ToolMessage } from '@langchain/core/messages';
import { Command, getCurrentTaskInput } from '@langchain/langgraph';
import { z } from 'zod';
import { getCapabilityDocsCatalog } from '@/lib/capabilities/catalog';
import {
  CAPABILITY_DOC_MAX_CONTENT_LENGTH,
  CAPABILITY_DOC_MAX_QUERY_LENGTH,
  CAPABILITY_DOC_MAX_RESULTS,
  CapabilityPage,
  CapabilitySection,
  capabilityPageUrl,
} from '@/lib/capabilities/types';
import { boundedText, getSectionByAnchor } from '@/lib/capabilities/search';
import {
  CAPABILITY_AVAILABILITY_STATUSES,
  getCapabilityAvailability,
  type CapabilityAvailability,
} from '@/lib/capabilities/availability';
import { defineTool } from '@/lib/tools/defineTool';
import type { SimplifiedAgentStateType } from '@/lib/state/chatAgentState';

const MAX_STATUS_REQUESTS = 8;
const MAX_TOOL_RESULT_LENGTH = 24_000;
const MAX_STATUS_LABEL_LENGTH = 100;
const MAX_TITLE_LENGTH = 200;
/** Room for the `kind`/`query`/`availability` fields and per-section metadata. */
const RESULT_ENVELOPE_RESERVE = 2_000;
const MIN_SECTION_CONTENT_LENGTH = 200;

export const YAAWCDocsToolSchema = z.object({
  query: z
    .string()
    .max(
      CAPABILITY_DOC_MAX_QUERY_LENGTH,
      'Capability documentation queries are limited to 500 characters.',
    )
    .optional()
    .default('')
    .describe(
      'A concise capability question or topic to find in the local docs.',
    ),
  page: z
    .string()
    .max(160)
    .optional()
    .describe('Exact catalogued page slug, without .md or a path.'),
  section: z
    .string()
    .max(200)
    .optional()
    .describe('Exact section anchor, used with page.'),
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(CAPABILITY_DOC_MAX_RESULTS)
    .optional()
    .describe(
      'Maximum number of matching sections; the server applies a hard cap.',
    ),
  status: z
    .union([
      z.string().max(MAX_STATUS_LABEL_LENGTH),
      z.array(z.string().max(MAX_STATUS_LABEL_LENGTH)).max(MAX_STATUS_REQUESTS),
    ])
    .optional()
    .describe(
      'Capability name(s) whose current local status should be reported.',
    ),
});

type YAAWCDocsInput = z.infer<typeof YAAWCDocsToolSchema>;

function bounded(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function safeQuery(query: string): string {
  return bounded(
    query.replace(/[\u0000-\u001f\u007f]/g, ' '),
    CAPABILITY_DOC_MAX_QUERY_LENGTH,
  );
}

function currentDocumentCount(): number {
  try {
    const state = getCurrentTaskInput() as SimplifiedAgentStateType;
    return state.relevantDocuments?.length ?? 0;
  } catch {
    return 0;
  }
}

function statusCapabilities(input: YAAWCDocsInput): string[] {
  const requested = (
    typeof input.status === 'string' ? [input.status] : (input.status ?? [])
  )
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(requested)].slice(0, MAX_STATUS_REQUESTS);
}

function documentForSection(
  section: CapabilitySection,
  sourceId: number,
  query: string,
): Document {
  return new Document({
    pageContent: boundedText(
      section.content,
      CAPABILITY_DOC_MAX_CONTENT_LENGTH,
    ),
    metadata: {
      sourceId,
      title: boundedText(
        `${section.pageTitle} — ${section.heading}`,
        MAX_TITLE_LENGTH,
      ),
      url: capabilityPageUrl(section.pageSlug, { anchor: section.anchor }),
      source: 'yaawc_docs',
      sourceType: 'internal',
      documentType: 'capability-doc',
      processingType: 'capability-doc',
      pageSlug: section.pageSlug,
      sectionAnchor: section.anchor,
      searchQuery: safeQuery(query),
    },
  });
}

function documentForPage(
  page: CapabilityPage,
  sourceId: number,
  query: string,
): Document {
  return new Document({
    pageContent: boundedText(page.markdown, CAPABILITY_DOC_MAX_CONTENT_LENGTH),
    metadata: {
      sourceId,
      title: boundedText(page.title, MAX_TITLE_LENGTH),
      url: capabilityPageUrl(page),
      source: 'yaawc_docs',
      sourceType: 'internal',
      documentType: 'capability-doc',
      processingType: 'capability-doc',
      pageSlug: page.slug,
      searchQuery: safeQuery(query),
    },
  });
}

function compactDocument(
  document: Document,
  contentBudget: number,
): Record<string, string | number> {
  return {
    sourceId: Number(document.metadata?.sourceId ?? 0),
    title: boundedText(
      String(document.metadata?.title ?? 'YAAWC capability documentation'),
      MAX_TITLE_LENGTH,
    ),
    url: String(document.metadata?.url ?? ''),
    content: boundedText(document.pageContent, contentBudget),
  };
}

/**
 * The result envelope is small and the section count is capped, so the share of
 * `MAX_TOOL_RESULT_LENGTH` each section may spend is known before serializing.
 */
function sectionContentBudget(sectionCount: number): number {
  if (sectionCount <= 0) return CAPABILITY_DOC_MAX_CONTENT_LENGTH;
  const perSection = Math.floor(
    (MAX_TOOL_RESULT_LENGTH - RESULT_ENVELOPE_RESERVE) / sectionCount,
  );
  return Math.max(
    MIN_SECTION_CONTENT_LENGTH,
    Math.min(perSection, CAPABILITY_DOC_MAX_CONTENT_LENGTH),
  );
}

function compactPayload(payload: Record<string, unknown>): string {
  const serialized = JSON.stringify(payload);
  if (serialized.length <= MAX_TOOL_RESULT_LENGTH) return serialized;

  // Sections are already bounded to their share of the budget, so overflow can
  // only come from an unexpectedly large envelope. Keep the message valid JSON;
  // truncating a serialized string would produce an unusable result.
  return JSON.stringify({
    kind: payload.kind ?? 'ok',
    query: typeof payload.query === 'string' ? safeQuery(payload.query) : '',
    message: 'Capability documentation results were bounded.',
  });
}

function toolMessage(content: string, toolCallId: string): ToolMessage {
  return new ToolMessage({ content, tool_call_id: toolCallId });
}

function responseCommand(
  documents: Document[],
  payload: Record<string, unknown>,
  toolCallId: string,
): Command {
  return new Command({
    update: {
      relevantDocuments: documents,
      messages: [toolMessage(compactPayload(payload), toolCallId)],
    },
  });
}

/**
 * Search the bundled, authoritative YAAWC capability corpus. This tool never
 * contacts a provider, uses embeddings, reads a user-supplied path, or persists
 * the query; its section Documents are the only sources it adds to the turn.
 */
export const yaawcDocsTool = defineTool(
  async (input: YAAWCDocsInput, runtime) => {
    const query = safeQuery(input.query ?? '');
    const pageSlug = input.page;
    const sectionAnchor = input.section;
    const catalog = getCapabilityDocsCatalog();
    const requestedStatuses = statusCapabilities(input);
    const statuses: CapabilityAvailability[] | CapabilityAvailability | null =
      requestedStatuses.length > 0
        ? getCapabilityAvailability(
            requestedStatuses,
            runtime.context.capabilityFacts?.() ?? {},
          )
        : null;
    const statusPayload = statuses ? { availability: statuses } : {};

    const ok = (documents: Document[]) => {
      const budget = sectionContentBudget(documents.length);
      return responseCommand(
        documents,
        {
          kind: 'ok',
          query,
          sections: documents.map((document) =>
            compactDocument(document, budget),
          ),
          ...statusPayload,
        },
        runtime.toolCallId,
      );
    };
    const failure = (kind: string, message: string) =>
      responseCommand(
        [],
        { kind, message, query, ...statusPayload },
        runtime.toolCallId,
      );

    if (requestedStatuses.length > 0 && !query && !pageSlug && !sectionAnchor) {
      return responseCommand(
        [],
        { kind: 'status', ...statusPayload },
        runtime.toolCallId,
      );
    }

    if (pageSlug) {
      const pageResult = await catalog.getPage(pageSlug);
      if (!pageResult.ok) return failure(pageResult.kind, pageResult.message);

      if (!sectionAnchor) {
        return ok([
          documentForPage(pageResult.value, currentDocumentCount() + 1, query),
        ]);
      }
      const section = getSectionByAnchor(pageResult.value, sectionAnchor);
      if (!section) {
        return failure(
          'no_match',
          'No matching YAAWC capability section was found.',
        );
      }
      return ok([
        documentForSection(section, currentDocumentCount() + 1, query),
      ]);
    }

    const result = await catalog.search(query, {
      maxResults: input.maxResults ?? 5,
      maxContentChars: CAPABILITY_DOC_MAX_CONTENT_LENGTH,
      pageSlug,
      sectionAnchor,
    });
    if (!result.ok) {
      return failure(
        result.kind,
        result.kind === 'unavailable'
          ? 'YAAWC capability documentation could not be loaded, so this claim cannot be verified.'
          : result.message,
      );
    }

    return ok(
      result.value.map((hit, index) =>
        documentForSection(
          hit.section,
          currentDocumentCount() + index + 1,
          query,
        ),
      ),
    );
  },
  {
    name: 'search_yaawc_docs',
    description: `Search the local YAAWC capability documentation for current features, prerequisites, limits, privacy, settings, availability, and failure behavior. Use this before making any YAAWC product claim. Use page/section for exact retrieval. You may request safe coarse status; statuses are only ${CAPABILITY_AVAILABILITY_STATUSES.join(', ')}. No network or external credentials are used.`,
    schema: YAAWCDocsToolSchema,
  },
);
