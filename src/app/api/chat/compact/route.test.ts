import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  default: { query: { chats: { findFirst: mocks.findFirst } } },
}));
vi.mock('@/lib/db/schema', () => ({
  chats: { id: 'chats.id' },
  messages: { messageId: 'messages.messageId' },
}));
vi.mock('@/lib/db/queries', () => ({
  getChatMessages: vi.fn(),
  getCompactionRows: vi.fn(),
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
