import { test, expect } from '../fixtures';
import { ChatPage } from '../pages/ChatPage';

const DIRECT_ANSWER = 'This is a deterministic test answer.';
const TOOL_ANSWER = 'Based on the document, the answer is deterministic.';

test.describe('agent panel', () => {
  // panelSelection is a DB-backed, instance-wide setting (not scoped per-chat)
  // — cross-device sync of the composer's active selection is a real feature
  // (see src/lib/settings/keys.ts) — so each test must leave it clean or the
  // next one hydrates a dirty selection. Reset it through the page's own
  // settings layer and wait for that write to reach the DB: an out-of-band
  // PATCH would race the composer's debounced flush, which the browser re-sends
  // with keepalive on pagehide and would land *after* the reset.
  test.afterEach(async ({ page }) => {
    const flushed = page.waitForResponse(
      (r) =>
        r.url().includes('/api/settings') &&
        r.request().method() === 'PATCH' &&
        (r.request().postData() ?? '').includes('"panelSelection":null'),
    );
    await page.evaluate(() => localStorage.removeItem('panelSelection'));
    await flushed;
  });

  test('enabling requires 2-4 executors before it is usable', async ({
    page,
  }) => {
    const chat = new ChatPage(page);
    await chat.goto('/');

    await chat.openAgentPanel();
    await chat.setAgentPanelEnabled(true);
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
    // container alone. Under heavy parallel-suite load the post-click
    // re-render can lag past the default 5s, so give it more room.
    await expect(page.getByText(DIRECT_ANSWER, { exact: true })).toHaveCount(
      2,
      { timeout: 10_000 },
    );

    // Persisted content carries one `yaawc:panel` fenced widget (its executor
    // answers as a typed JSON array) followed by the synthesized answer as
    // plain trailing text.
    const chatId = new URL(page.url()).pathname.split('/').pop()!;
    const body = await (await request.get(`/api/chats/${chatId}`)).json();
    const msgs: Array<{ role: string; content: string }> = body.messages;
    const assistantMsg = msgs.find((m) => m.role === 'assistant');
    const match = assistantMsg?.content.match(
      /```yaawc:panel\n([^\n]*)\n```\n*([\s\S]*)/,
    );
    expect(match).not.toBeNull();
    const decoded = JSON.parse(match![1]);
    expect(decoded.columns).toEqual([
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

  test('an executor answer with a chart and citations keeps the panel widget renderable', async ({
    page,
  }) => {
    const chat = new ChatPage(page);

    await chat.goto('/');
    await chat.configureAgentPanel(['Test (chart answer)', 'Test (direct)']);
    await chat.sendMessage(`panel-chart-${Date.now()}`);
    await chat.waitForStreamComplete();

    const header = page.getByRole('button', { name: /Agent Panel · 2 models/ });
    await expect(header).toBeVisible();
    await header.click();

    // The executor's `<Chart id/>` and `[1]` citation ride inside the panel
    // envelope's one-line JSON payload. If any message-level rewrite reaches in
    // there, the payload stops parsing and the widget degrades to a raw code
    // block — so assert the column rendered, chart and all.
    const columns = page.locator('div.hidden.sm\\:flex');
    await expect(
      columns.getByText('Charted the deterministic findings'),
    ).toBeVisible();
    await expect(columns.locator('.recharts-wrapper').first()).toBeVisible();
    await expect(page.getByText('yaawc:panel')).toHaveCount(0);
  });
});
