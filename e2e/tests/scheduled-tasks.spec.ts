import { test, expect } from '../fixtures';
import { seedWorkflow, seedSchedule } from '../utils/seed';
import { uniq } from '../utils/helpers';

test.describe('automations: Scheduled Tasks tab', () => {
  test('lists schedule definitions, not the chats they produced', async ({
    page,
    request,
  }) => {
    const label = uniq('sched-ui');
    const workflowName = uniq('sched-ui-wf');
    const workflowId = await seedWorkflow(request, { name: workflowName });
    const scheduleId = await seedSchedule(request, workflowId, { label });
    const { chatId } = await (
      await request.post(`/api/schedules/${scheduleId}/run`)
    ).json();

    await page.goto('/automations/scheduled');

    // The definition is listed, with its enable toggle and edit link.
    const row = page.locator(`[data-schedule-id="${scheduleId}"]`);
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row.getByText(label, { exact: true })).toBeVisible();
    await expect(row.getByText(workflowName, { exact: true })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Enabled' })).toBeVisible();
    await expect(
      row.locator(`a[href="/automations/schedules/${scheduleId}"]`),
    ).toBeVisible();

    // The run it produced is reachable from History, not listed as a feed row
    // on this tab. Only the "Open last run" link may point at a chat.
    const chatLinks = row.locator(`a[href="/c/${chatId}"]`);
    await expect(chatLinks).toHaveCount(1);
    await expect(chatLinks).toHaveText('Open last run');
  });

  test('opening a scheduled run marks it read', async ({ page, request }) => {
    const workflowId = await seedWorkflow(request);
    const scheduleId = await seedSchedule(request, workflowId);
    const { chatId } = await (
      await request.post(`/api/schedules/${scheduleId}/run`)
    ).json();

    const unread = async () =>
      (await (await request.get(`/api/chats/${chatId}`)).json()).chat
        .lastRunViewed;
    expect(await unread()).toBe(0);

    await page.goto(`/c/${chatId}`);
    await expect(
      page.getByText('This is a deterministic test answer.'),
    ).toBeVisible({ timeout: 15_000 });

    await expect.poll(unread, { timeout: 10_000 }).toBe(1);
  });
});
