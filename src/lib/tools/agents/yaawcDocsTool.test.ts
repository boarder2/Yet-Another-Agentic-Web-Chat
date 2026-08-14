import { beforeEach, describe, expect, it, vi } from 'vitest';

const langGraphMocks = vi.hoisted(() => ({
  getCurrentTaskInput: vi.fn(),
}));

vi.mock('@langchain/langgraph', async () => {
  const actual = await vi.importActual<typeof import('@langchain/langgraph')>(
    '@langchain/langgraph',
  );
  return { ...actual, getCurrentTaskInput: langGraphMocks.getCurrentTaskInput };
});

import {
  createCapabilityCatalog,
  setCapabilityDocsCatalogForTests,
  type CapabilityDocsLoader,
} from '@/lib/capabilities/catalog';
import {
  CAPABILITY_DOC_MAX_CONTENT_LENGTH,
  CAPABILITY_DOC_MAX_RESULTS,
} from '@/lib/capabilities/types';
import { yaawcDocsTool } from './yaawcDocsTool';

type ToolUpdate = {
  relevantDocuments?: Array<{
    pageContent: string;
    metadata?: Record<string, unknown>;
  }>;
  messages?: Array<{ content?: unknown }>;
};

type ToolCommand = { update?: ToolUpdate };

const guide = `# YAAWC guide

## Web search

YAAWC can search the web and cite sources.

## Private sessions

Private sessions do not retain durable chat data.

## Web search

Duplicate headings receive distinct anchors.
`;

const loader = (files: Record<string, string>): CapabilityDocsLoader => ({
  listFiles: () => Object.keys(files),
  readFile: (filename) => {
    const content = files[filename];
    if (content === undefined) throw new Error('missing fixture');
    return content;
  },
});

const setCatalog = (markdown = guide) => {
  setCapabilityDocsCatalogForTests(
    createCapabilityCatalog(loader({ 'chat-and-research.md': markdown })),
  );
};

const invokableTool = yaawcDocsTool as unknown as {
  invoke(input: unknown, config: unknown): Promise<unknown>;
};

const invokeTool = async (
  input: Record<string, unknown>,
  capabilityFacts: Record<string, unknown> = {},
): Promise<ToolCommand> => {
  const toolCall = {
    type: 'tool_call',
    name: 'search_yaawc_docs',
    id: 'docs-call-1',
    args: input,
  };
  const runtime = {
    context: { capabilityFacts },
    state: { relevantDocuments: [] },
    toolCallId: 'docs-call-1',
    config: {},
    store: null,
    writer: null,
  };
  const result = await invokableTool.invoke(toolCall, runtime);
  return result as unknown as ToolCommand;
};

const payloadFrom = (command: ToolCommand): Record<string, unknown> => {
  const content = command.update?.messages?.[0]?.content;
  if (typeof content !== 'string') throw new Error('missing tool payload');
  return JSON.parse(content) as Record<string, unknown>;
};

describe('search_yaawc_docs tool', () => {
  beforeEach(() => {
    langGraphMocks.getCurrentTaskInput.mockReturnValue({
      relevantDocuments: [{}, {}],
    });
    setCatalog();
  });

  it('returns bounded section Documents with exact internal citation URLs', async () => {
    const command = await invokeTool({ query: 'web search', maxResults: 5 });
    const documents = command.update?.relevantDocuments ?? [];

    expect(documents).toHaveLength(3);
    expect(documents[0]).toMatchObject({
      pageContent: expect.stringContaining('search the web'),
      metadata: {
        sourceId: 3,
        source: 'yaawc_docs',
        sourceType: 'internal',
        documentType: 'capability-doc',
        processingType: 'capability-doc',
        pageSlug: 'chat-and-research',
        sectionAnchor: 'web-search',
        url: '/docs/capabilities/chat-and-research#web-search',
        searchQuery: 'web search',
      },
    });
    expect(documents[1].metadata?.url).toBe(
      '/docs/capabilities/chat-and-research#web-search-1',
    );

    const payload = payloadFrom(command);
    expect(payload).toMatchObject({
      kind: 'ok',
      query: 'web search',
    });
    expect(payload.sections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceId: 3,
          url: '/docs/capabilities/chat-and-research#web-search',
        }),
      ]),
    );
    expect(JSON.stringify(payload)).not.toContain('chat-and-research.md');
    expect(JSON.stringify(payload)).not.toContain('/workspaces/');
  });

  it('supports exact page and duplicate-heading section retrieval', async () => {
    const command = await invokeTool({
      page: 'chat-and-research',
      section: 'web-search-1',
    });
    const documents = command.update?.relevantDocuments ?? [];

    expect(documents).toHaveLength(1);
    expect(documents[0].metadata).toMatchObject({
      url: '/docs/capabilities/chat-and-research#web-search-1',
      sectionAnchor: 'web-search-1',
    });
    expect(documents[0].pageContent).toContain('Duplicate headings');
  });

  it('reports safe coarse status without exposing runtime facts', async () => {
    const command = await invokeTool(
      {
        status: {
          capabilities: ['web search', 'memory', 'unknown service'],
        },
      },
      {
        focusMode: 'webSearch',
        isPrivate: true,
        memoryEnabled: true,
        searchCapabilities: { web: true },
      },
    );

    expect(command.update?.relevantDocuments).toEqual([]);
    expect(payloadFrom(command)).toEqual({
      kind: 'status',
      availability: [
        { capability: 'web search', status: 'available' },
        { capability: 'memory', status: 'disabled' },
        { capability: 'unknown service', status: 'unknown on this device' },
      ],
    });
    expect(JSON.stringify(payloadFrom(command))).not.toMatch(
      /(?:true|false|docker|secret|\/workspaces)/i,
    );
  });

  it('fails closed for no-match, invalid page input, and unavailable corpora', async () => {
    const noMatch = await invokeTool({ query: 'unrelated astronomy topic' });
    expect(payloadFrom(noMatch)).toMatchObject({
      kind: 'no_match',
      message: expect.stringContaining('No matching'),
    });
    expect(noMatch.update?.relevantDocuments).toEqual([]);

    const invalidPage = await invokeTool({ page: '../etc/passwd' });
    expect(payloadFrom(invalidPage)).toMatchObject({
      kind: 'invalid',
      message: expect.stringContaining('invalid'),
    });
    expect(JSON.stringify(invalidPage)).not.toContain('/etc/passwd');

    setCapabilityDocsCatalogForTests(
      createCapabilityCatalog({
        listFiles: () => ['chat-and-research.md'],
        readFile: () => {
          throw new Error('/private/absolute/path/chat-and-research.md');
        },
      }),
    );
    const unavailable = await invokeTool({ query: 'web search' });
    expect(payloadFrom(unavailable)).toMatchObject({
      kind: 'unavailable',
      message: expect.stringContaining('cannot be verified'),
    });
    expect(JSON.stringify(unavailable)).not.toContain('/private/absolute/path');
  });

  it('bounds document and serialized tool-result sizes and rejects oversized queries', async () => {
    const sections = Array.from(
      { length: CAPABILITY_DOC_MAX_RESULTS + 2 },
      (_, index) => `## Feature ${index}\n\n${'content '.repeat(1_500)}`,
    ).join('\n\n');
    setCatalog(`# Guide\n\n${sections}`);

    const command = await invokeTool({
      query: '',
      maxResults: CAPABILITY_DOC_MAX_RESULTS,
    });
    const documents = command.update?.relevantDocuments ?? [];

    expect(documents).toHaveLength(CAPABILITY_DOC_MAX_RESULTS);
    expect(
      documents.every(
        (document) =>
          document.pageContent.length <= CAPABILITY_DOC_MAX_CONTENT_LENGTH,
      ),
    ).toBe(true);
    const message = command.update?.messages?.[0]?.content;
    expect(typeof message).toBe('string');
    expect(String(message).length).toBeLessThanOrEqual(24_000);

    await expect(invokeTool({ query: 'x'.repeat(501) })).rejects.toThrow();
  });
});
