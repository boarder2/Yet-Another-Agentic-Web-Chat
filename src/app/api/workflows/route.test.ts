import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const values = vi.fn();
  const execute = vi.fn();
  return {
    values,
    execute,
    insert: vi.fn(() => ({ values })),
    findFirst: vi.fn(),
  };
});

vi.mock('@/lib/db', () => ({
  default: {
    insert: mocks.insert,
    query: { workflows: { findFirst: mocks.findFirst } },
  },
}));
vi.mock('@/lib/db/schema', () => ({
  chats: { workflowId: 'workflowId', activeRunMessageId: 'activeRunMessageId' },
  workflows: { id: 'id' },
}));

import { POST } from './route';

const request = (body: unknown) =>
  new Request('http://localhost/api/workflows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /api/workflows model-reference validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue(undefined);
    mocks.values.mockReturnValue({ execute: mocks.execute });
    mocks.findFirst.mockResolvedValue({ id: 'workflow-1' });
  });

  it('returns HTTP 400 and does not persist a malformed effort', async () => {
    const response = await POST(
      request({
        name: 'Invalid workflow',
        prompt: 'Research this',
        chatModel: {
          provider: 'openai',
          name: 'gpt-5.4',
          reasoningEffort: 'default',
        },
      }) as never,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining('Invalid reasoning effort'),
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('persists exact role effort refs and keeps an omitted System ref null', async () => {
    await POST(
      request({
        name: 'Durable workflow',
        prompt: 'Research this',
        chatModel: {
          provider: 'openai',
          name: 'gpt-5.4',
          reasoningEffort: 'high',
        },
        systemModel: null,
      }) as never,
    );

    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        chatModel: {
          provider: 'openai',
          name: 'gpt-5.4',
          reasoningEffort: 'high',
        },
        systemModel: null,
      }),
    );
  });
});
