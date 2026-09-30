import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  insertValues: vi.fn(),
  getChatMessages: vi.fn(),
  getCompactionRows: vi.fn(),
  invoke: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  default: {
    query: { chats: { findFirst: mocks.findFirst } },
    insert: () => ({
      values: (v: unknown) => {
        mocks.insertValues(v);
        return { execute: async () => {} };
      },
    }),
  },
}));
vi.mock('@/lib/db/schema', () => ({
  chats: { id: 'chats.id' },
  messages: { messageId: 'messages.messageId' },
}));
vi.mock('@/lib/db/queries', () => ({
  getChatMessages: mocks.getChatMessages,
  getCompactionRows: mocks.getCompactionRows,
}));
vi.mock('@/lib/providers/resolveModels', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveChatAndEmbedding: async () => ({
    systemLlm: { invoke: mocks.invoke },
  }),
}));

import { POST } from './route';

const request = (body: unknown) =>
  new Request('http://localhost/api/chat/compact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /api/chat/compact model-reference validation', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    {
      name: 'chat effort',
      chatModel: {
        provider: 'openai',
        name: 'gpt-5.4',
        reasoningEffort: 'default',
      },
    },
    {
      name: 'system effort',
      chatModel: { provider: 'openai', name: 'gpt-5.4' },
      systemModel: {
        provider: 'anthropic',
        name: 'claude-opus-4-6',
        reasoningEffort: 'MAX',
      },
    },
  ])(
    'returns HTTP 400 for malformed $name before reading the chat',
    async ({ chatModel, systemModel }) => {
      const response = await POST(
        request({ chatId: 'chat-1', chatModel, systemModel }),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: expect.stringContaining('Invalid reasoning effort'),
      });
      expect(mocks.findFirst).not.toHaveBeenCalled();
    },
  );
});

describe('POST /api/chat/compact checkpoint', () => {
  beforeEach(() => vi.clearAllMocks());

  it('anchors the marker to the last visible row and never estimates negative tokens', async () => {
    mocks.findFirst.mockResolvedValue({ activeRunMessageId: null });
    mocks.getCompactionRows.mockResolvedValue([]);
    mocks.invoke.mockResolvedValue({ content: 'summary' });
    // The first chat call saw only the user turn; the turn's large tool
    // output rows came after the assistant row.
    mocks.getChatMessages.mockResolvedValue([
      { id: 1, role: 'user', content: 'q', metadata: '{}' },
      {
        id: 2,
        role: 'assistant',
        content: 'a',
        metadata: JSON.stringify({
          modelStats: { firstChatCallInputTokens: 1000 },
        }),
      },
      { id: 3, role: 'system', content: 'x'.repeat(40_000), metadata: '{}' },
    ]);

    const response = await POST(request({ chatId: 'chat-1' }));

    expect(response.status).toBe(200);
    const meta = JSON.parse(mocks.insertValues.mock.calls[0][0].metadata);
    expect(meta).toMatchObject({ compactedUpTo: 3, positionId: 2 });
    expect(meta.tokensAfter).toBe(Math.ceil('summary'.length / 4));
  });
});
