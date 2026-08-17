import path from 'node:path';
import Database from 'better-sqlite3';
import { test, expect } from '../fixtures';
import type { APIRequestContext, Page } from '../fixtures/api';
import { ChatPage } from '../pages/ChatPage';
import { baseURL, uid } from '../utils/helpers';
import {
  collectSseEvents,
  eventsOfType,
  joinResponseText,
  streamChatUntil,
  type ChatEvent,
} from '../utils/sse';
import { seedChat } from '../utils/seed';

const DB_PATH = path.resolve('e2e/.test-data/db.sqlite');
const CHART_ANSWER_PREFIX = 'Charted the deterministic findings';

function chatBody({
  chatId,
  messageId,
  model,
  focusMode = 'webSearch',
}: {
  chatId: string;
  messageId: string;
  model: string;
  focusMode?: string;
}): Record<string, unknown> {
  return {
    message: {
      messageId,
      chatId,
      content: `chart-e2e-${model}-${Date.now()}`,
    },
    focusMode,
    files: [],
    chatModel: { provider: 'test', name: model },
    systemModel: { provider: 'test', name: 'test-direct' },
    selectedSystemPromptIds: [],
    workspaceId: null,
  };
}

async function runChartTurn(
  request: APIRequestContext,
  model: string,
  focusMode = 'webSearch',
): Promise<{ chatId: string; messageId: string; events: ChatEvent[] }> {
  const chatId = uid();
  const messageId = uid();
  const response = await request.post('/api/chat', {
    data: chatBody({ chatId, messageId, model, focusMode }),
  });
  expect(response.status()).toBe(200);
  return { chatId, messageId, events: await collectSseEvents(response) };
}

async function openChat(page: Page, chatId: string): Promise<ChatPage> {
  const chat = new ChatPage(page);
  await chat.goto(`/c/${chatId}`);
  return chat;
}

async function seedHistoricalChartChat(
  request: APIRequestContext,
): Promise<string> {
  const chatId = await seedChat(request, {
    content: 'Historical chart fixture',
    chatModel: 'test-direct',
  });
  const db = new Database(DB_PATH);
  try {
    const row = db
      .prepare(
        "SELECT id, metadata FROM messages WHERE chatId = ? AND type = 'assistant' ORDER BY id DESC LIMIT 1",
      )
      .get(chatId) as { id: number; metadata: string | null } | undefined;
    if (!row) throw new Error('historical chart assistant row missing');
    const parsedMetadata = row.metadata ? JSON.parse(row.metadata) : {};
    const metadata =
      typeof parsedMetadata === 'string'
        ? JSON.parse(parsedMetadata)
        : parsedMetadata;
    metadata.chartSpecs = {
      'legacy-chart': {
        type: 'bar',
        title: 'Historical chart',
        data: [{ label: 'A', series_1: 1 }],
        series: [{ key: 'series_1', label: 'Value' }],
        xKey: 'label',
      },
    };
    db.prepare(
      'UPDATE messages SET content = ?, metadata = ?, sanitized_content = ? WHERE id = ?',
    ).run(
      '<Chart id="legacy-chart"/>',
      JSON.stringify(JSON.stringify(metadata)),
      '',
      row.id,
    );
  } finally {
    db.close();
  }
  return chatId;
}

test.describe('chat chart lifecycle', () => {
  test('places a chart-only writer widget without raw tags or tool chrome', async ({
    page,
    request,
  }) => {
    const { chatId, events } = await runChartTurn(
      request,
      'test-chart-create-show',
    );

    expect(eventsOfType(events, 'chart_spec')).toHaveLength(1);
    expect(eventsOfType(events, 'chart_placement')).toHaveLength(1);
    expect(eventsOfType(events, 'tool_call_started')).toHaveLength(0);
    expect(joinResponseText(events)).toContain(CHART_ANSWER_PREFIX);

    const chat = await openChat(page, chatId);
    const answer = page.locator('[data-answer]').last();
    await expect(answer.getByText(CHART_ANSWER_PREFIX)).toBeVisible();
    await expect(answer.locator('.recharts-wrapper')).toHaveCount(1);
    await expect(page.locator('[data-execution]')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('<Chart id=');

    const body = await (await request.get(`/api/chats/${chatId}`)).json();
    const assistant = body.messages.find(
      (message: { role: string }) => message.role === 'assistant',
    ) as { content: string; metadata: string };
    expect(assistant.content).toContain('```yaawc:chart');
    expect(assistant.content).not.toContain('<Chart id=');
    expect(JSON.parse(assistant.metadata).chartSpecs).toBeTruthy();
    await chat.waitForStreamComplete();
  });

  test('recovers from an invalid handle and allows repeated or unshown charts', async ({
    page,
    request,
  }) => {
    const recovered = await runChartTurn(request, 'test-chart-unknown');
    expect(eventsOfType(recovered.events, 'chart_placement')).toHaveLength(1);
    expect(eventsOfType(recovered.events, 'tool_call_started')).toHaveLength(0);
    await openChat(page, recovered.chatId);
    await expect(page.locator('[data-answer] .recharts-wrapper')).toHaveCount(
      1,
    );

    const repeated = await runChartTurn(request, 'test-chart-repeat');
    expect(eventsOfType(repeated.events, 'chart_placement')).toHaveLength(2);
    await openChat(page, repeated.chatId);
    await expect(page.locator('[data-answer] .recharts-wrapper')).toHaveCount(
      2,
    );

    const unshown = await runChartTurn(request, 'test-chart-unshown');
    expect(eventsOfType(unshown.events, 'chart_spec')).toHaveLength(1);
    expect(eventsOfType(unshown.events, 'chart_placement')).toHaveLength(0);
    const body = await (
      await request.get(`/api/chats/${unshown.chatId}`)
    ).json();
    const assistant = body.messages.find(
      (message: { role: string }) => message.role === 'assistant',
    ) as { content: string; metadata: string };
    expect(assistant.content).not.toContain('yaawc:chart');
    expect(JSON.parse(assistant.metadata).chartSpecs).toBeUndefined();
  });

  test('places a narrated chart and strips its placeholder text', async ({
    page,
    request,
  }) => {
    const { chatId, events } = await runChartTurn(
      request,
      'test-chart-mention',
    );

    expect(eventsOfType(events, 'chart_placement')).toHaveLength(1);

    const chat = await openChat(page, chatId);
    const answer = page.locator('[data-answer]').last();
    await expect(answer.locator('.recharts-wrapper')).toHaveCount(1);
    await expect(answer).not.toContainText('{chart_1}');
    await expect(answer).not.toContainText('show_chart');

    const body = await (await request.get(`/api/chats/${chatId}`)).json();
    const assistant = body.messages.find(
      (message: { role: string }) => message.role === 'assistant',
    ) as { content: string };
    expect(assistant.content).toContain('```yaawc:chart');
    expect(assistant.content).not.toContain('{chart_1}');
    await chat.waitForStreamComplete();
  });

  test('makes chart tools available in Chat mode and survives reload', async ({
    page,
    request,
  }) => {
    const { chatId, events } = await runChartTurn(
      request,
      'test-chart-create-show',
      'chat',
    );
    expect(eventsOfType(events, 'chart_spec')).toHaveLength(1);
    expect(eventsOfType(events, 'chart_placement')).toHaveLength(1);

    await openChat(page, chatId);
    await expect(page.locator('[data-answer] .recharts-wrapper')).toHaveCount(
      1,
    );
    await page.reload();
    await expect(page.locator('[data-answer] .recharts-wrapper')).toHaveCount(
      1,
    );
  });

  test('preserves the chart registry through an approval pause and resume', async ({
    page,
    request,
  }) => {
    const chatId = uid();
    const messageId = uid();
    const events = await streamChatUntil(
      baseURL(),
      chatBody({
        chatId,
        messageId,
        model: 'test-chart-approval',
        focusMode: 'chat',
      }),
      (current) => current.some((event) => event.type === 'ask_user_pending'),
    );
    const pending = events.find((event) => event.type === 'ask_user_pending');
    expect(pending).toBeTruthy();
    const approvalId = (pending?.data as Record<string, unknown>)?.approvalId;

    const chat = await openChat(page, chatId);
    await expect(
      page
        .locator('[data-approval-panel]')
        .getByText('Continue showing the deterministic chart?', {
          exact: true,
        }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    await chat.waitForStreamComplete();

    expect(typeof approvalId).toBe('string');
    await expect(page.locator('[data-answer] .recharts-wrapper')).toHaveCount(
      1,
    );
    const body = await (await request.get(`/api/chats/${chatId}`)).json();
    const assistant = body.messages.find(
      (message: { role: string }) => message.role === 'assistant',
    ) as { content: string };
    expect(assistant.content).toContain('```yaawc:chart');
  });

  test('keeps raw streamed tags absent while rendering historical chart tags', async ({
    page,
    request,
  }) => {
    const streamed = await runChartTurn(request, 'test-chart-raw-tag');
    expect(joinResponseText(streamed.events)).toContain('<Chart id=');
    const streamedBody = await (
      await request.get(`/api/chats/${streamed.chatId}`)
    ).json();
    const streamedAssistant = streamedBody.messages.find(
      (message: { role: string }) => message.role === 'assistant',
    ) as { content: string };
    expect(streamedAssistant.content).not.toContain('<Chart id=');

    const historicalChatId = await seedHistoricalChartChat(request);
    await openChat(page, historicalChatId);
    await expect(
      page.getByText('Historical chart', { exact: true }),
    ).toBeVisible();
    await expect(page.locator('[data-answer] .recharts-wrapper')).toHaveCount(
      1,
    );
  });
});
