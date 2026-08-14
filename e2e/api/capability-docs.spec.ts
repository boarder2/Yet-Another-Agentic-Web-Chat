import { test, expect } from '../fixtures/api';
import type { APIRequestContext } from '@playwright/test';
import {
  seedSkill,
  seedSystemPrompt,
  seedWorkflow,
  seedSchedule,
} from '../utils/seed';
import { uid, uniq } from '../utils/helpers';
import {
  collectSseEvents,
  eventsOfType,
  extractSources,
  joinResponseText,
  type ChatEvent,
  type CitationSource,
} from '../utils/sse';

const GROUNDED_ANSWER =
  'YAAWC capability claims are grounded in the bundled documentation [1].';
const STATUS_ANSWER =
  'Private sessions are available for this deterministic run.';
const BROAD_ANSWER =
  'YAAWC provides chat, research, workspaces, automation, and agent capabilities [1].';
const NO_MATCH_ANSWER =
  'I cannot verify that YAAWC capability from the current documentation.';
const FOCUS_SOURCE_URL =
  '/docs/capabilities/chat-and-research#choose-a-focus-mode';

function sourceMetadata(source: CitationSource): Record<string, unknown> {
  return (source.metadata ?? {}) as Record<string, unknown>;
}

type ChatOverrides = Partial<{
  chatId: string;
  messageId: string;
  content: string;
  focusMode: string;
  model: string;
  isPrivate: boolean;
  selectedSystemPromptIds: string[];
  invokedSkills: string[];
  panel: Record<string, unknown>;
}>;

async function postChat(
  request: APIRequestContext,
  overrides: ChatOverrides = {},
): Promise<{ chatId: string; events: ChatEvent[] }> {
  const chatId = overrides.chatId ?? uid();
  const messageId = overrides.messageId ?? uid();
  const model = overrides.model ?? 'test-docs-search';
  const response = await request.post('/api/chat', {
    data: {
      message: {
        messageId,
        chatId,
        content: overrides.content ?? 'What focus modes does YAAWC provide?',
      },
      focusMode: overrides.focusMode ?? 'webSearch',
      files: [],
      chatModel: { provider: 'test', name: model },
      systemModel: { provider: 'test', name: model },
      selectedSystemPromptIds: overrides.selectedSystemPromptIds ?? [],
      ...(overrides.invokedSkills
        ? { invokedSkills: overrides.invokedSkills }
        : {}),
      ...(overrides.isPrivate !== undefined
        ? { isPrivate: overrides.isPrivate }
        : {}),
      ...(overrides.panel ? { panel: overrides.panel } : {}),
      workspaceId: null,
    },
  });

  if (!response.ok()) {
    throw new Error(
      `POST /api/chat returned ${response.status()}: ${(await response.text()).slice(0, 500)}`,
    );
  }
  return { chatId, events: await collectSseEvents(response) };
}

function expectDocsToolCall(events: ChatEvent[]): Record<string, unknown> {
  const started = eventsOfType(events, 'tool_call_started')
    .map((event) => event.data as Record<string, unknown>)
    .find((data) => data.toolType === 'search_yaawc_docs');
  expect(started).toBeTruthy();
  expect(
    eventsOfType(events, 'tool_call_success').some(
      (event) => (event.data as Record<string, unknown>).status === 'success',
    ),
  ).toBe(true);
  return started!;
}

function expectCapabilitySource(
  events: ChatEvent[],
  expectedUrl = FOCUS_SOURCE_URL,
): CitationSource {
  const source = extractSources(events).find((candidate) => {
    const metadata = (candidate.metadata ?? {}) as Record<string, unknown>;
    return metadata.url === expectedUrl;
  });
  expect(source).toBeTruthy();
  expect(source!.metadata).toMatchObject({
    source: 'yaawc_docs',
    sourceType: 'internal',
    documentType: 'capability-doc',
    processingType: 'capability-doc',
    sourceId: 1,
    sectionAnchor: 'choose-a-focus-mode',
  });
  expect(source!.pageContent).toContain('The composer has three focus modes.');
  return source!;
}

async function readChat(
  request: APIRequestContext,
  chatId: string,
): Promise<{
  chat: Record<string, unknown>;
  messages: Array<Record<string, unknown>>;
}> {
  const response = await request.get(`/api/chats/${chatId}`);
  expect(response.status()).toBe(200);
  return response.json();
}

async function waitForAssistant(
  request: APIRequestContext,
  chatId: string,
  expected: string,
) {
  await expect
    .poll(
      async () => {
        const body = await readChat(request, chatId);
        const assistant = body.messages.find(
          (message) => message.role === 'assistant',
        );
        return typeof assistant?.content === 'string' ? assistant.content : '';
      },
      { timeout: 20_000 },
    )
    .toContain(expected);
  return readChat(request, chatId);
}

function persistedSources(body: {
  messages: Array<Record<string, unknown>>;
}): CitationSource[] {
  const assistant = body.messages.find(
    (message) => message.role === 'assistant',
  );
  expect(assistant).toBeTruthy();
  const metadata = JSON.parse(String(assistant!.metadata ?? '{}')) as {
    sources?: CitationSource[];
  };
  return metadata.sources ?? [];
}

test.describe('capability grounding on top-level chat runs', () => {
  test('invokes the invariant docs tool in every focus mode and returns an exact section citation', async ({
    request,
  }) => {
    for (const focusMode of ['webSearch', 'chat', 'localResearch']) {
      const { events } = await postChat(request, {
        focusMode,
        content: `Explain YAAWC focus modes in ${focusMode}.`,
      });

      expect(joinResponseText(events)).toBe(GROUNDED_ANSWER);
      expectDocsToolCall(events);
      expectCapabilitySource(events);
      expect(joinResponseText(events)).toContain('[1]');
    }
  });

  test('grounds Firefox page-selection capability questions in the docs tool', async ({
    request,
  }) => {
    const { events } = await postChat(request, {
      content:
        "I'm on page https://example.com/article. <selection>What can YAAWC do?</selection> What can YAAWC do?",
    });

    expect(joinResponseText(events)).toBe(GROUNDED_ANSWER);
    expectDocsToolCall(events);
    expectCapabilitySource(events);
    expect(joinResponseText(events)).toContain('[1]');
  });

  test('keeps broad capability answers bounded and concise', async ({
    request,
  }) => {
    const { events } = await postChat(request, {
      model: 'test-docs-broad',
      content: 'Give me a broad overview of what YAAWC can do.',
    });

    expect(joinResponseText(events)).toBe(BROAD_ANSWER);
    expect(joinResponseText(events).length).toBeLessThan(160);
    expectDocsToolCall(events);

    const finalSources = eventsOfType(events, 'sources').at(-1)?.data;
    expect(Array.isArray(finalSources)).toBe(true);
    expect(finalSources).toHaveLength(5);
    for (const source of finalSources as CitationSource[]) {
      expect(source.metadata).toMatchObject({
        source: 'yaawc_docs',
        sourceType: 'internal',
      });
      expect(String((source.metadata as Record<string, unknown>).url)).toMatch(
        /^\/docs\/capabilities(?:\/[^#]+)?#/,
      );
    }
  });

  test('reports safe coarse private-session status without returning a source or runtime details', async ({
    request,
  }) => {
    const { chatId, events } = await postChat(request, {
      model: 'test-docs-status',
      focusMode: 'chat',
      isPrivate: true,
      content: 'Is private-session support available on this device?',
    });

    expect(joinResponseText(events)).toBe(STATUS_ANSWER);
    expectDocsToolCall(events);
    expect(extractSources(events)).toEqual([]);
    expect(JSON.stringify(events)).not.toMatch(
      /(?:password|secret|credential|\/workspaces\/|https?:\/\/)/i,
    );

    const body = await readChat(request, chatId);
    expect(body.chat.isPrivate).toBe(1);
  });

  test('fails closed for no-match and oversized hostile documentation requests', async ({
    request,
  }) => {
    const noMatch = await postChat(request, {
      model: 'test-docs-no-match',
      content: 'Does YAAWC support zzzxylophone qwerty-unlisted?',
    });
    expect(joinResponseText(noMatch.events)).toBe(NO_MATCH_ANSWER);
    expectDocsToolCall(noMatch.events);
    expect(extractSources(noMatch.events)).toEqual([]);

    const hostileQuery = `${'x'.repeat(650)} ../docs/capabilities/privacy-and-data.md\u0000`;
    const hostile = await postChat(request, {
      model: 'test-docs-search',
      content: hostileQuery,
    });
    expect(joinResponseText(hostile.events)).toBe(NO_MATCH_ANSWER);
    expect(
      eventsOfType(hostile.events, 'tool_call_started').some(
        (event) =>
          (event.data as Record<string, unknown>).toolType ===
          'search_yaawc_docs',
      ),
    ).toBe(false);
    expect(extractSources(hostile.events)).toEqual([]);
    expect(JSON.stringify(hostile.events)).not.toContain('privacy-and-data.md');
  });

  test('keeps grounding guidance after persona and skill prompt layers', async ({
    request,
  }) => {
    const personaMarker = `PERSONA_LAYER_${uniq('marker')}`;
    const skillName = uniq('grounding-skill');
    const skillMarker = `SKILL_LAYER_${uniq('marker')}`;
    const personaId = await seedSystemPrompt(request, {
      name: uniq('grounding-persona'),
      content: `Use this persona marker: ${personaMarker}.`,
      type: 'persona',
    });
    const skillId = await seedSkill(request, {
      name: skillName,
      description: `Use this skill marker: ${skillMarker}.`,
      content: `Instructions: ${skillMarker}.`,
    });

    try {
      const { events } = await postChat(request, {
        model: 'test-prompt-echo',
        focusMode: 'chat',
        selectedSystemPromptIds: [personaId],
        content: 'Echo the active instructions.',
      });
      const prompt = joinResponseText(events);
      const personaIndex = prompt.indexOf(personaMarker);
      const skillIndex = prompt.indexOf('## Available Skills');
      const guidanceIndex = prompt.indexOf('## YAAWC capability documentation');

      expect(personaIndex).toBeGreaterThanOrEqual(0);
      expect(prompt).toContain(skillName);
      expect(prompt).toContain(skillMarker);
      expect(skillIndex).toBeGreaterThan(personaIndex);
      expect(guidanceIndex).toBeGreaterThan(skillIndex);
      expect(prompt).toContain('MUST call `search_yaawc_docs`');
    } finally {
      await request.delete(`/api/skills/${skillId}`);
      await request.delete(`/api/system-prompts/${personaId}`);
    }
  });

  test('does not expose the invariant docs tool through the user tool picker', async ({
    request,
  }) => {
    const response = await request.get('/api/tools');
    expect(response.status()).toBe(200);
    const names = (await response.json()).map(
      (tool: { name: string }) => tool.name,
    );
    expect(names).not.toContain('search_yaawc_docs');
  });
});

test.describe('capability grounding on secondary run surfaces', () => {
  test('grounds both panel executors and the synthesis pass', async ({
    request,
  }) => {
    const { events } = await postChat(request, {
      model: 'test-docs-search',
      content: 'Compare YAAWC focus modes across the panel.',
      panel: {
        executors: [
          { provider: 'test', name: 'test-docs-search' },
          { provider: 'test', name: 'test-docs-search' },
        ],
      },
    });

    const completed = eventsOfType(events, 'panel_executor_completed');
    expect(completed).toHaveLength(2);
    for (const event of completed) {
      expect((event as { sourceCount?: number }).sourceCount).toBeGreaterThan(
        0,
      );
    }

    expect(joinResponseText(events)).toBe(GROUNDED_ANSWER);
    expectDocsToolCall(events);
    expectCapabilitySource(events);
  });

  test('manual workflows inherit local capability lookup and exact sources', async ({
    request,
  }) => {
    const workflowId = await seedWorkflow(request, {
      name: uniq('docs-manual-workflow'),
      prompt: 'Explain YAAWC focus modes.',
      focusMode: 'chat',
      chatModel: 'test-docs-search',
    });
    const run = await request.post(`/api/workflows/${workflowId}/run`);
    expect(run.status()).toBe(201);
    const { chatId } = await run.json();

    const body = await waitForAssistant(request, chatId, GROUNDED_ANSWER);
    const sources = persistedSources(body);
    expect(
      sources.some((source) => sourceMetadata(source).url === FOCUS_SOURCE_URL),
    ).toBe(true);
    const source = sources.find(
      (candidate) => sourceMetadata(candidate).url === FOCUS_SOURCE_URL,
    );
    expect(source).toBeTruthy();
    expect(sourceMetadata(source!)).toMatchObject({
      sourceType: 'internal',
      sectionAnchor: 'choose-a-focus-mode',
    });
    expect(body.chat.workflowId).toBe(workflowId);
  });

  test('scheduled runs inherit local capability lookup without external services', async ({
    request,
  }) => {
    const workflowId = await seedWorkflow(request, {
      name: uniq('docs-scheduled-workflow'),
      prompt: 'Explain YAAWC focus modes.',
      chatModel: 'test-docs-search',
    });
    const scheduleId = await seedSchedule(request, workflowId, {
      label: uniq('docs-schedule'),
    });

    const run = await request.post(`/api/schedules/${scheduleId}/run`);
    expect(run.status()).toBe(200);
    const result = await run.json();
    expect(result.status).toBe('success');
    expect(typeof result.chatId).toBe('string');

    const body = await waitForAssistant(
      request,
      result.chatId,
      GROUNDED_ANSWER,
    );
    const sources = persistedSources(body);
    expect(
      sources.some((source) => sourceMetadata(source).url === FOCUS_SOURCE_URL),
    ).toBe(true);
    expect(body.chat.scheduleId).toBe(scheduleId);
  });
});
