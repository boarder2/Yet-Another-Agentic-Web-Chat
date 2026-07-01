import { test, expect } from '../fixtures';
import { ChatPage } from '../pages/ChatPage';

const DIRECT_ANSWER = 'This is a deterministic test answer.';
const TOOL_ANSWER = 'Based on the document, the answer is deterministic.';

test.describe('agent panel', () => {
  test('enabling requires 2-4 executors before it is usable', async ({
    page,
  }) => {
    const chat = new ChatPage(page);
    await chat.goto('/');

    await chat.openAgentPanel();
    await chat.toggleAgentPanelEnabled();
    await expect(
      page.getByText('Select 2–4 executors to use the panel.'),
    ).toBeVisible();

    await chat.addPanelExecutor('Test (direct)');
    await expect(
      page.getByText('Select 2–4 executors to use the panel.'),
    ).toBeVisible();

    await chat.addPanelExecutor('Test (slow stream)');
    await expect(
      page.getByText('Select 2–4 executors to use the panel.'),
    ).toHaveCount(0);
  });

  test('fans a prompt across 2 executors, shows per-executor progress, and synthesizes one answer', async ({
    page,
    request,
  }) => {
    const chat = new ChatPage(page);
    const query = `panel-${Date.now()}`;

    await chat.goto('/');
    // "Test (slow stream)" takes ~1.8s to answer (paced token delivery) while
    // "Test (tool loop)" resolves near-instantly, giving a real window to
    // observe one executor still running while the other has completed.
    await chat.configureAgentPanel(['Test (tool loop)', 'Test (slow stream)']);
    await chat.sendMessage(query);

    const header = page.getByRole('button', {
      name: /Agent Panel · 2 models/,
    });
    await expect(header).toBeVisible();
    // Both executors are identified in the collapsed header while running.
    await expect(header.getByText('test-tool')).toBeVisible();
    await expect(header.getByText('test-slow')).toBeVisible();
    // The slow executor is still spinning while the tool-loop one has settled.
    await expect(header.locator('svg.animate-spin')).toHaveCount(1, {
      timeout: 3_000,
    });

    await chat.waitForStreamComplete();

    // Both executors succeeded once the run settles.
    await expect(header.locator('svg.animate-spin')).toHaveCount(0);
    await expect(header.locator('svg.text-success')).toHaveCount(2);

    // Expand to see each executor's own deterministic answer. PanelColumns
    // renders both a mobile (tab + single column) and a desktop (side-by-side)
    // layout at once, CSS-switched by viewport — scope to the desktop columns
    // to see each executor exactly once regardless of which mobile tab is active.
    await header.click();
    const columns = page.locator('div.hidden.sm\\:flex');
    await expect(columns.getByText(TOOL_ANSWER)).toBeVisible();
    await expect(
      columns.getByText(DIRECT_ANSWER, { exact: true }),
    ).toBeVisible();
    // The synthesized final answer (outside the panel block) also reads the
    // plain "test-direct" answer, since the fake orchestrator ignores
    // executor content — so the page now has one more match than the columns
    // container alone.
    await expect(page.getByText(DIRECT_ANSWER, { exact: true })).toHaveCount(2);

    // Persisted content carries both the panel markup (its executor answers
    // are base64-encoded inside the tag's `data` attribute) and the
    // synthesized answer as plain trailing text.
    const chatId = new URL(page.url()).pathname.split('/').pop()!;
    const body = await (await request.get(`/api/chats/${chatId}`)).json();
    const msgs: Array<{ role: string; content: string }> = body.messages;
    const assistantMsg = msgs.find((m) => m.role === 'assistant');
    const match = assistantMsg?.content.match(
      /<PanelColumns data="([^"]*)"><\/PanelColumns>\n([\s\S]*)/,
    );
    expect(match).not.toBeNull();
    const decoded = JSON.parse(
      Buffer.from(match![1], 'base64').toString('utf-8'),
    );
    expect(decoded.executors).toEqual([
      expect.objectContaining({
        model: 'test-tool',
        responseText: TOOL_ANSWER,
      }),
      expect.objectContaining({
        model: 'test-slow',
        responseText: DIRECT_ANSWER,
      }),
    ]);
    expect(match![2].trim()).toBe(DIRECT_ANSWER);
  });
});
