import { test, expect } from '../fixtures/api';
import { seedWorkflow, seedSchedule } from '../utils/seed';
import { uniq } from '../utils/helpers';

test.describe('POST /api/workflows/[id]/schedules', () => {
  test('creates a schedule with a complete fill-set', async ({ request }) => {
    const workflowId = await seedWorkflow(request, {
      prompt: '---\ncompany:\n---\nResearch {{company}}',
    });
    const label = uniq('sched');
    const res = await request.post(`/api/workflows/${workflowId}/schedules`, {
      data: {
        label,
        cronExpression: '0 0 * * *',
        inputValues: { company: 'Acme' },
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.workflowId).toBe(workflowId);
    expect(body.label).toBe(label);
    expect(body.cronExpression).toBe('0 0 * * *');
    expect(body.inputValues).toEqual({ company: 'Acme' });
    expect(body.enabled).toBe(1);
  });

  test('rejects a schedule whose fill-set is incomplete', async ({
    request,
  }) => {
    const workflowId = await seedWorkflow(request, {
      prompt: '---\ncompany:\n---\nResearch {{company}}',
    });
    const res = await request.post(`/api/workflows/${workflowId}/schedules`, {
      data: {
        label: uniq('bad'),
        cronExpression: '0 0 * * *',
        inputValues: {},
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Incomplete fill-set');
    expect(body.missing).toContain('company');
  });

  test('rejects a fill-set with an out-of-options select value', async ({
    request,
  }) => {
    const workflowId = await seedWorkflow(request, {
      prompt: '---\ntone: select | options=Formal, Casual\n---\nTone: {{tone}}',
    });
    const res = await request.post(`/api/workflows/${workflowId}/schedules`, {
      data: {
        label: uniq('bad-opt'),
        cronExpression: '0 0 * * *',
        inputValues: { tone: 'Zany' },
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Incomplete fill-set');
    expect(body.missing).toContain('tone');
  });

  test('rejects an invalid cron expression', async ({ request }) => {
    const workflowId = await seedWorkflow(request);
    const res = await request.post(`/api/workflows/${workflowId}/schedules`, {
      data: { label: uniq('bad-cron'), cronExpression: 'not a cron' },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe('Invalid cron expression');
  });

  test('returns 400 when label or cron is missing', async ({ request }) => {
    const workflowId = await seedWorkflow(request);
    const res = await request.post(`/api/workflows/${workflowId}/schedules`, {
      data: { cronExpression: '0 0 * * *' },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe(
      'Missing required fields: label, cronExpression',
    );
  });
});

test.describe('GET /api/schedules', () => {
  test('lists schedules joined to their workflow name', async ({ request }) => {
    const workflowId = await seedWorkflow(request, {
      name: uniq('wf-for-list'),
    });
    const scheduleId = await seedSchedule(request, workflowId, {
      label: 'list-sched',
    });
    const res = await request.get('/api/schedules');
    expect(res.status()).toBe(200);
    const body = await res.json();
    const entry = body.find((s: { id: string }) => s.id === scheduleId);
    expect(entry).toBeTruthy();
    expect(entry.label).toBe('list-sched');
    expect(entry.workflowName).toBeTruthy();
    expect(entry.running).toBe(false);
  });
});

test.describe('GET/PATCH/DELETE /api/schedules/[id]', () => {
  test('PATCH re-validates an incomplete fill-set', async ({ request }) => {
    const workflowId = await seedWorkflow(request, {
      prompt: '---\ncompany:\n---\nResearch {{company}}',
    });
    const scheduleId = await seedSchedule(request, workflowId, {
      inputValues: { company: 'Acme' },
    });
    const res = await request.patch(`/api/schedules/${scheduleId}`, {
      data: { inputValues: {} },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe('Incomplete fill-set');
  });

  test('PATCH re-enabling clears the auto-disable reason', async ({
    request,
  }) => {
    const workflowId = await seedWorkflow(request, { prompt: 'Static' });
    const scheduleId = await seedSchedule(request, workflowId);
    // Invalidate via a workflow edit to auto-disable + set a reason.
    await request.patch(`/api/workflows/${workflowId}`, {
      data: { prompt: '---\ncompany:\n---\nReport on {{company}}' },
    });
    let schedule = await (
      await request.get(`/api/schedules/${scheduleId}`)
    ).json();
    expect(schedule.enabled).toBe(0);
    expect(schedule.disabledReason).toBeTruthy();

    // Re-enable after supplying the now-required input.
    const res = await request.patch(`/api/schedules/${scheduleId}`, {
      data: { enabled: true, inputValues: { company: 'Acme' } },
    });
    expect(res.status()).toBe(200);
    schedule = await res.json();
    expect(schedule.enabled).toBe(1);
    expect(schedule.disabledReason).toBeNull();
  });

  test('DELETE keeps past run chats (scheduleId nulled)', async ({
    request,
  }) => {
    const workflowId = await seedWorkflow(request, { prompt: 'Say hello' });
    const scheduleId = await seedSchedule(request, workflowId);
    const { chatId } = await (
      await request.post(`/api/schedules/${scheduleId}/run`)
    ).json();

    const del = await request.delete(`/api/schedules/${scheduleId}`);
    expect(del.status()).toBe(200);
    expect(await del.json()).toEqual({ success: true });

    expect((await request.get(`/api/schedules/${scheduleId}`)).status()).toBe(
      404,
    );
    const chatBody = await (await request.get(`/api/chats/${chatId}`)).json();
    expect(chatBody.chat.scheduleId).toBeNull();
  });
});

test.describe('POST /api/schedules/[id]/run', () => {
  test('runs a schedule and produces a scheduled-run chat', async ({
    request,
  }) => {
    const workflowId = await seedWorkflow(request, {
      prompt: 'What is 2+2?',
    });
    const scheduleId = await seedSchedule(request, workflowId, {
      label: 'run-now-sched',
    });
    const res = await request.post(`/api/schedules/${scheduleId}/run`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('success');
    expect(typeof body.chatId).toBe('string');

    const chatBody = await (
      await request.get(`/api/chats/${body.chatId}`)
    ).json();
    expect(chatBody.chat.scheduleId).toBe(scheduleId);
    const userMsg = chatBody.messages.find(
      (m: { role: string }) => m.role === 'user',
    );
    expect(userMsg.content).toBe('What is 2+2?');
    const assistantMsg = chatBody.messages.find(
      (m: { role: string }) => m.role === 'assistant',
    );
    expect(assistantMsg.content).toBe('This is a deterministic test answer.');
  });

  test('schedule reflects last run status after a run', async ({ request }) => {
    const workflowId = await seedWorkflow(request);
    const scheduleId = await seedSchedule(request, workflowId);
    const { chatId } = await (
      await request.post(`/api/schedules/${scheduleId}/run`)
    ).json();

    const schedule = await (
      await request.get(`/api/schedules/${scheduleId}`)
    ).json();
    expect(schedule.lastRunStatus).toBe('success');
    expect(schedule.lastRunChatId).toBe(chatId);
  });
});

test.describe('scheduled runs unread flow', () => {
  test('a finished run counts as unread history; opening it clears the count', async ({
    request,
  }) => {
    const workflowId = await seedWorkflow(request);
    const scheduleId = await seedSchedule(request, workflowId);
    const { chatId } = await (
      await request.post(`/api/schedules/${scheduleId}/run`)
    ).json();

    // A headless scheduled run leaves the chat with a terminal run status and
    // no viewer, so it is an ordinary unread run in History.
    const chat = await (await request.get(`/api/chats/${chatId}`)).json();
    expect(chat.chat.lastRunStatus).toBe('completed');
    expect(chat.chat.lastRunViewed).toBe(0);

    const activeBefore = await (
      await request.get('/api/chat/runs/active')
    ).json();
    expect(activeBefore.unreadCount).toBeGreaterThan(0);

    // Marking it seen clears the flag and drops the global unread count.
    const seen = await request.post(`/api/chats/${chatId}/seen`);
    expect(seen.status()).toBe(200);
    const { historyCount } = await seen.json();
    expect(historyCount).toBe(activeBefore.unreadCount - 1);

    const after = await (await request.get(`/api/chats/${chatId}`)).json();
    expect(after.chat.lastRunViewed).toBe(1);
  });
});
