import { Document } from '@langchain/core/documents';
import { ToolMessage } from '@langchain/core/messages';
import { Command, getCurrentTaskInput } from '@langchain/langgraph';
import { z } from 'zod';
import {
  capabilityPageUrl,
  capabilitySectionUrl,
  getCapabilityDocsCatalog,
} from '@/lib/capabilities/catalog';
import {
  CAPABILITY_DOC_MAX_CONTENT_LENGTH,
  CAPABILITY_DOC_MAX_QUERY_LENGTH,
  CAPABILITY_DOC_MAX_RESULTS,
  CapabilityPage,
  CapabilitySection,
} from '@/lib/capabilities/types';
import { getSectionByAnchor } from '@/lib/capabilities/search';
import {
  getCapabilityAvailability,
  type CapabilityAvailability,
  type CapabilityRuntimeFacts,
} from '@/lib/capabilities/availability';
import { defineTool } from '@/lib/tools/defineTool';
import type { SimplifiedAgentStateType } from '@/lib/state/chatAgentState';

const MAX_STATUS_REQUESTS = 8;
const MAX_TOOL_RESULT_LENGTH = 24_000;
const MAX_STATUS_LABEL_LENGTH = 100;
const MAX_TITLE_LENGTH = 200;

const statusObjectSchema = z.object({
  capability: z.string().max(MAX_STATUS_LABEL_LENGTH).optional(),
  capabilities: z
    .array(z.string().max(MAX_STATUS_LABEL_LENGTH))
    .max(MAX_STATUS_REQUESTS)
    .optional(),
});

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
  slug: z.string().max(160).optional().describe('Alias for page.'),
  anchor: z.string().max(200).optional().describe('Alias for section.'),
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
      z.boolean(),
      z.string().max(MAX_STATUS_LABEL_LENGTH),
      z.array(z.string().max(MAX_STATUS_LABEL_LENGTH)).max(MAX_STATUS_REQUESTS),
      statusObjectSchema,
    ])
    .optional()
    .describe(
      'Optional capability name(s) whose current local status should be reported.',
    ),
  capability: z
    .string()
    .max(MAX_STATUS_LABEL_LENGTH)
    .optional()
    .describe('Capability name to check when requesting status.'),
  includeStatus: z
    .boolean()
    .optional()
    .describe('Include safe coarse availability for the requested capability.'),
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

function getRuntimeFacts(
  context: Parameters<typeof getCapabilityAvailability>[1],
): CapabilityRuntimeFacts {
  return context ?? {};
}

function statusCapabilities(input: YAAWCDocsInput): string[] {
  const requested: string[] = [];
  const add = (value: unknown) => {
    if (typeof value === 'string' && value.trim()) requested.push(value.trim());
  };

  if (typeof input.capability === 'string') add(input.capability);
  if (typeof input.status === 'string') add(input.status);
  if (Array.isArray(input.status)) input.status.forEach(add);
  if (
    input.status &&
    typeof input.status === 'object' &&
    !Array.isArray(input.status)
  ) {
    add(input.status.capability);
    input.status.capabilities?.forEach(add);
  }
  if (
    (input.includeStatus || input.status === true) &&
    requested.length === 0
  ) {
    add(input.query);
  }

  return [...new Set(requested)].slice(0, MAX_STATUS_REQUESTS);
}

function pageForSection(
  pages: readonly CapabilityPage[],
  section: CapabilitySection,
): CapabilityPage | null {
  return pages.find((page) => page.slug === section.pageSlug) ?? null;
}

function documentForSection(
  section: CapabilitySection,
  page: CapabilityPage | null,
  sourceId: number,
  query: string,
): Document {
  const url = page
    ? capabilitySectionUrl(page, section.anchor)
    : capabilityPageUrl(section.pageSlug, { anchor: section.anchor });
  return new Document({
    pageContent: bounded(section.content, CAPABILITY_DOC_MAX_CONTENT_LENGTH),
    metadata: {
      sourceId,
      title: bounded(
        `${section.pageTitle} — ${section.heading}`,
        MAX_TITLE_LENGTH,
      ),
      url,
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
    pageContent: bounded(page.markdown, CAPABILITY_DOC_MAX_CONTENT_LENGTH),
    metadata: {
      sourceId,
      title: bounded(page.title, MAX_TITLE_LENGTH),
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

function compactDocument(document: Document): Record<string, string | number> {
  return {
    sourceId: Number(document.metadata?.sourceId ?? 0),
    title: bounded(
      String(document.metadata?.title ?? 'YAAWC capability documentation'),
      MAX_TITLE_LENGTH,
    ),
    url: String(document.metadata?.url ?? ''),
    content: bounded(document.pageContent, CAPABILITY_DOC_MAX_CONTENT_LENGTH),
  };
}

function compactPayload(payload: Record<string, unknown>): string {
  const sections = payload.sections;
  if (!Array.isArray(sections)) {
    const serialized = JSON.stringify(payload);
    if (serialized.length <= MAX_TOOL_RESULT_LENGTH) return serialized;
  }
  if (Array.isArray(sections)) {
    let compactSections = sections.map((section) =>
      section && typeof section === 'object'
        ? { ...(section as Record<string, unknown>) }
        : section,
    );
    let previousLength = Number.POSITIVE_INFINITY;

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = JSON.stringify({
        ...payload,
        sections: compactSections,
      });
      if (candidate.length <= MAX_TOOL_RESULT_LENGTH) return candidate;

      if (candidate.length >= previousLength && compactSections.length > 1) {
        compactSections = compactSections.slice(0, -1);
      } else {
        compactSections = compactSections.map((section) => {
          if (!section || typeof section !== 'object') return section;
          const record = section as Record<string, unknown>;
          return {
            ...record,
            content:
              typeof record.content === 'string'
                ? bounded(
                    record.content,
                    Math.max(200, Math.floor(record.content.length * 0.75)),
                  )
                : record.content,
          };
        });
      }
      previousLength = candidate.length;
    }
  }

  // Keep the tool message valid JSON even if a future payload grows beyond the
  // hard bound; truncating a serialized string would create an unusable result.
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
    const pageSlug = input.page ?? input.slug;
    const sectionAnchor = input.section ?? input.anchor;
    const catalog = getCapabilityDocsCatalog();
    const requestedStatuses = statusCapabilities(input);
    const statuses: CapabilityAvailability[] | CapabilityAvailability | null =
      requestedStatuses.length > 0
        ? getCapabilityAvailability(
            requestedStatuses,
            getRuntimeFacts(runtime.context.capabilityFacts),
          )
        : null;
    const statusPayload = statuses ? { availability: statuses } : {};

    if (requestedStatuses.length > 0 && !query && !pageSlug && !sectionAnchor) {
      return responseCommand(
        [],
        { kind: 'status', ...statusPayload },
        runtime.toolCallId,
      );
    }

    if (pageSlug && sectionAnchor) {
      const pageResult = await catalog.getPage(pageSlug);
      if (!pageResult.ok) {
        return responseCommand(
          [],
          {
            kind: pageResult.kind,
            message: pageResult.message,
            query,
            ...statusPayload,
          },
          runtime.toolCallId,
        );
      }
      const section = getSectionByAnchor(pageResult.value, sectionAnchor);
      if (!section) {
        return responseCommand(
          [],
          {
            kind: 'no_match',
            message: 'No matching YAAWC capability section was found.',
            query,
            ...statusPayload,
          },
          runtime.toolCallId,
        );
      }
      const document = documentForSection(
        section,
        pageResult.value,
        currentDocumentCount() + 1,
        query,
      );
      return responseCommand(
        [document],
        {
          kind: 'ok',
          query,
          sections: [compactDocument(document)],
          ...statusPayload,
        },
        runtime.toolCallId,
      );
    }

    if (pageSlug) {
      const pageResult = await catalog.getPage(pageSlug);
      if (!pageResult.ok) {
        return responseCommand(
          [],
          {
            kind: pageResult.kind,
            message: pageResult.message,
            query,
            ...statusPayload,
          },
          runtime.toolCallId,
        );
      }
      const document = documentForPage(
        pageResult.value,
        currentDocumentCount() + 1,
        query,
      );
      return responseCommand(
        [document],
        {
          kind: 'ok',
          query,
          sections: [compactDocument(document)],
          ...statusPayload,
        },
        runtime.toolCallId,
      );
    }

    const result = await catalog.search(query, {
      maxResults: input.maxResults ?? 5,
      maxContentChars: CAPABILITY_DOC_MAX_CONTENT_LENGTH,
      pageSlug,
      sectionAnchor,
    });
    if (!result.ok) {
      return responseCommand(
        [],
        {
          kind: result.kind,
          message:
            result.kind === 'unavailable'
              ? 'YAAWC capability documentation could not be loaded, so this claim cannot be verified.'
              : result.message,
          query,
          ...statusPayload,
        },
        runtime.toolCallId,
      );
    }

    const pagesResult = await catalog.load();
    const pages = pagesResult.ok ? pagesResult.value : [];
    const documents = result.value.map((hit, index) =>
      documentForSection(
        hit.section,
        pageForSection(pages, hit.section),
        currentDocumentCount() + index + 1,
        query,
      ),
    );
    return responseCommand(
      documents,
      {
        kind: 'ok',
        query,
        sections: documents.map(compactDocument),
        ...statusPayload,
      },
      runtime.toolCallId,
    );
  },
  {
    name: 'search_yaawc_docs',
    description:
      'Search the local YAAWC capability documentation for current features, prerequisites, limits, privacy, settings, availability, and failure behavior. Use this before making any YAAWC product claim. Use page/section for exact retrieval. You may request safe coarse status; statuses are only available, disabled, not configured, or unknown on this device. No network or external credentials are used.',
    schema: YAAWCDocsToolSchema,
  },
);

export const searchYAAWCDocsTool = yaawcDocsTool;
