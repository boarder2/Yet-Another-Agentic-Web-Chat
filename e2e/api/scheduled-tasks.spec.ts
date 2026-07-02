import { test, expect } from '../fixtures/api';
import { seedScheduledTask } from '../utils/seed';
import { uniq } from '../utils/helpers';

test.describe('POST /api/scheduled-tasks', () => {
  test('creates a task with valid body', async ({ request }) => {
    const name = uniq('create-test');
    const res = await request.post('/api/scheduled-tasks', {
      data: {
        name,
        prompt: 'Say hello',
        cronExpression: '0 0 1 1 *',
        chatModel: { provider: 'test', name: 'test-direct' },
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(typeof body.id).toBe('string');
    expect(body.id.length).toBeGreaterThan(0);
    expect(body.name).toBe(name);
    expect(body.prompt).toBe('Say hello');
    expect(body.cronExpression).toBe('0 0 1 1 *');
    expect(body.enabled).toBe(1);
    expect(body.focusMode).toBe('webSearch');
    expect(body.sourceUrls).toEqual([]);
    expect(body.selectedSystemPromptIds).toEqual([]);
  });

  test('returns 400 when prompt is missing', async ({ request }) => {
    const res = await request.post('/api/scheduled-tasks', {
      data: {
        name: uniq('no-prompt'),
        cronExpression: '0 0 1 1 *',
        chatModel: { provider: 'test', name: 'test-direct' },
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: 'Missing required fields: name, prompt, cronExpression, chatModel',
    });
  });

  test('returns 400 when cronExpression is missing', async ({ request }) => {
    const res = await request.post('/api/scheduled-tasks', {
      data: {
        name: uniq('no-cron'),
        prompt: 'Say hello',
        chatModel: { provider: 'test', name: 'test-direct' },
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: 'Missing required fields: name, prompt, cronExpression, chatModel',
    });
  });

  test('returns 400 when chatModel is missing', async ({ request }) => {
    const res = await request.post('/api/scheduled-tasks', {
      data: {
        name: uniq('no-model'),
        prompt: 'Say hello',
        cronExpression: '0 0 1 1 *',
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: 'Missing required fields: name, prompt, cronExpression, chatModel',
    });
  });

  test('returns 400 for invalid cron expression', async ({ request }) => {
    const res = await request.post('/api/scheduled-tasks', {
      data: {
        name: uniq('bad-cron'),
        prompt: 'Say hello',
        cronExpression: 'not a cron',
        chatModel: { provider: 'test', name: 'test-direct' },
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'Invalid cron expression' });
  });

  test('creates task with optional fields persisted', async ({ request }) => {
    const res = await request.post('/api/scheduled-tasks', {
      data: {
        name: uniq('opt-fields'),
        prompt: 'Research topic',
        cronExpression: '*/15 * * * *',
        chatModel: { provider: 'test', name: 'test-tool' },
        focusMode: 'localResearch',
        sourceUrls: ['https://example.com/a', 'https://example.com/b'],
        systemModel: { provider: 'test', name: 'test-direct' },
        selectedSystemPromptIds: ['sp-1', 'sp-2'],
        timezone: 'America/New_York',
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.focusMode).toBe('localResearch');
    expect(body.sourceUrls).toEqual([
      'https://example.com/a',
      'https://example.com/b',
    ]);
    expect(body.chatModel).toEqual({
      provider: 'test',
      name: 'test-tool',
    });
    expect(body.systemModel).toEqual({
      provider: 'test',
      name: 'test-direct',
    });
    expect(body.selectedSystemPromptIds).toEqual(['sp-1', 'sp-2']);
    expect(body.timezone).toBe('America/New_York');
    expect(body.cronExpression).toBe('*/15 * * * *');
    expect(body.enabled).toBe(1);
  });

  test('creates task with enabled set to false', async ({ request }) => {
    const res = await request.post('/api/scheduled-tasks', {
      data: {
        name: uniq('disabled-task'),
        prompt: 'Say hello',
        cronExpression: '0 0 1 1 *',
        chatModel: { provider: 'test', name: 'test-direct' },
        enabled: false,
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.enabled).toBe(0);
    expect(body.name).toBeTruthy();
  });
});

test.describe('GET /api/scheduled-tasks', () => {
  test('returns an array and a seeded task appears in it', async ({
    request,
  }) => {
    const taskId = await seedScheduledTask(request, {
      name: 'list-test-task',
    });
    const res = await request.get('/api/scheduled-tasks');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    const task = body.find((t: { id: string }) => t.id === taskId);
    expect(task).toBeTruthy();
    expect(task.name).toBe('list-test-task');
    expect(task.running).toBe(false);
  });
});

test.describe('GET /api/scheduled-tasks/[id]', () => {
  test('returns task for valid id', async ({ request }) => {
    const taskId = await seedScheduledTask(request, {
      name: 'get-by-id-task',
    });
    const res = await request.get(`/api/scheduled-tasks/${taskId}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(taskId);
    expect(body.name).toBe('get-by-id-task');
  });

  test('returns 404 for nonexistent id', async ({ request }) => {
    const res = await request.get(
      '/api/scheduled-tasks/00000000-0000-0000-0000-000000000000',
    );
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: 'Not found' });
  });
});

test.describe('PATCH /api/scheduled-tasks/[id]', () => {
  test('updates name and prompt', async ({ request }) => {
    const taskId = await seedScheduledTask(request, { name: 'original-name' });
    const res = await request.patch(`/api/scheduled-tasks/${taskId}`, {
      data: { name: 'updated-name', prompt: 'Updated prompt' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('updated-name');
    expect(body.prompt).toBe('Updated prompt');

    // Re-GET confirms persistence
    const getRes = await request.get(`/api/scheduled-tasks/${taskId}`);
    const getBody = await getRes.json();
    expect(getBody.name).toBe('updated-name');
    expect(getBody.prompt).toBe('Updated prompt');
  });

  test('returns 400 for invalid cronExpression in update', async ({
    request,
  }) => {
    const taskId = await seedScheduledTask(request);
    const res = await request.patch(`/api/scheduled-tasks/${taskId}`, {
      data: { cronExpression: 'not a cron' },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({ error: 'Invalid cron expression' });
  });

  test('toggles enabled to false', async ({ request }) => {
    const taskId = await seedScheduledTask(request);
    const res = await request.patch(`/api/scheduled-tasks/${taskId}`, {
      data: { enabled: false },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.enabled).toBe(0);
  });

  test('toggles enabled from disabled back to enabled', async ({ request }) => {
    // Create disabled, then re-enable
    const createRes = await request.post('/api/scheduled-tasks', {
      data: {
        name: uniq('reenable'),
        prompt: 'Test',
        cronExpression: '0 0 1 1 *',
        chatModel: { provider: 'test', name: 'test-direct' },
        enabled: false,
      },
    });
    expect(createRes.status()).toBe(201);
    const { id } = await createRes.json();

    const patchRes = await request.patch(`/api/scheduled-tasks/${id}`, {
      data: { enabled: true },
    });
    expect(patchRes.status()).toBe(200);
    const body = await patchRes.json();
    expect(body.enabled).toBe(1);

    // Confirm persisted
    const getRes = await request.get(`/api/scheduled-tasks/${id}`);
    expect((await getRes.json()).enabled).toBe(1);
  });

  test('updates focusMode and sourceUrls', async ({ request }) => {
    const taskId = await seedScheduledTask(request, { name: 'update-opts' });
    const res = await request.patch(`/api/scheduled-tasks/${taskId}`, {
      data: {
        focusMode: 'localResearch',
        sourceUrls: ['https://example.com/src'],
      },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.focusMode).toBe('localResearch');
    expect(body.sourceUrls).toEqual(['https://example.com/src']);

    // Re-GET confirms
    const getRes = await request.get(`/api/scheduled-tasks/${taskId}`);
    const getBody = await getRes.json();
    expect(getBody.focusMode).toBe('localResearch');
    expect(getBody.sourceUrls).toEqual(['https://example.com/src']);
  });

  test('returns 404 for nonexistent id', async ({ request }) => {
    const res = await request.patch(
      '/api/scheduled-tasks/00000000-0000-0000-0000-000000000000',
      { data: { name: 'nope' } },
    );
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: 'Not found' });
  });
});

test.describe('DELETE /api/scheduled-tasks/[id]', () => {
  test('deletes a task and subsequent GET returns 404', async ({ request }) => {
    const taskId = await seedScheduledTask(request, { name: 'delete-me' });
    const res = await request.delete(`/api/scheduled-tasks/${taskId}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ success: true });

    const getRes = await request.get(`/api/scheduled-tasks/${taskId}`);
    expect(getRes.status()).toBe(404);
  });
});

test.describe('POST /api/scheduled-tasks/[id]/run', () => {
  test('runs a task and returns chatId with success status', async ({
    request,
  }) => {
    const taskId = await seedScheduledTask(request, {
      name: 'run-test-task',
      prompt: 'What is the capital of France?',
    });
    const res = await request.post(`/api/scheduled-tasks/${taskId}/run`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(typeof body.chatId).toBe('string');
    expect(body.chatId.length).toBeGreaterThan(0);
    expect(body.status).toBe('success');
  });

  test('run creates chat with deterministic answer and user prompt', async ({
    request,
  }) => {
    const prompt = 'What is 2+2?';
    const taskId = await seedScheduledTask(request, {
      name: 'run-content-test',
      prompt,
    });
    const runRes = await request.post(`/api/scheduled-tasks/${taskId}/run`);
    expect(runRes.status()).toBe(200);
    const { chatId } = await runRes.json();

    // Fetch the chat to check messages
    const chatRes = await request.get(`/api/chats/${chatId}`);
    expect(chatRes.status()).toBe(200);
    const chatBody = await chatRes.json();
    expect(chatBody.chat.scheduledTaskId).toBe(taskId);

    // User message = task prompt
    const userMsg = chatBody.messages.find(
      (m: { role: string }) => m.role === 'user',
    );
    expect(userMsg).toBeTruthy();
    expect(userMsg.content).toBe(prompt);

    // Assistant message = deterministic test answer
    const assistantMsg = chatBody.messages.find(
      (m: { role: string }) => m.role === 'assistant',
    );
    expect(assistantMsg).toBeTruthy();
    expect(assistantMsg.content).toBe('This is a deterministic test answer.');
  });

  test('task reflects last run status after successful run', async ({
    request,
  }) => {
    const taskId = await seedScheduledTask(request, {
      name: 'run-status-test',
    });
    const runRes = await request.post(`/api/scheduled-tasks/${taskId}/run`);
    const { chatId } = await runRes.json();

    const taskRes = await request.get(`/api/scheduled-tasks/${taskId}`);
    expect(taskRes.status()).toBe(200);
    const task = await taskRes.json();
    expect(task.lastRunStatus).toBe('success');
    expect(task.lastRunChatId).toBe(chatId);
  });
});

test.describe('GET /api/scheduled-tasks/[id]/runs', () => {
  test('returns runs for a task after execution', async ({ request }) => {
    const taskId = await seedScheduledTask(request, { name: 'runs-list-test' });
    const runRes = await request.post(`/api/scheduled-tasks/${taskId}/run`);
    const { chatId } = await runRes.json();

    const res = await request.get(`/api/scheduled-tasks/${taskId}/runs`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    const ids: string[] = body.map((r: { id: string }) => r.id);
    expect(ids).toContain(chatId);
  });
});

test.describe('GET /api/scheduled-tasks/runs', () => {
  test('includes run entry with taskName, preview, and sourcesCount', async ({
    request,
  }) => {
    const taskName = uniq('all-runs-task');
    const taskId = await seedScheduledTask(request, { name: taskName });
    const runRes = await request.post(`/api/scheduled-tasks/${taskId}/run`);
    const { chatId } = await runRes.json();

    const res = await request.get('/api/scheduled-tasks/runs');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    const entry = body.find((r: { id: string }) => r.id === chatId);
    expect(entry).toBeTruthy();
    expect(entry.taskName).toBe(taskName);
    expect(entry.scheduledTaskId).toBe(taskId);
    expect(entry.preview).toBe('This is a deterministic test answer.');
    expect(entry.sourcesCount).toBe(0);
  });
});

test.describe('scheduled runs unread/view flow', () => {
  test('viewing a run marks it viewed and re-viewing is idempotent', async ({
    request,
  }) => {
    // Create and run a task — the completed run is unviewed.
    const taskId = await seedScheduledTask(request, {
      name: uniq('unread-test'),
    });
    const runRes = await request.post(`/api/scheduled-tasks/${taskId}/run`);
    const { chatId } = await runRes.json();

    // After a fresh run, the run chat is unviewed.
    const runsBefore = await request.get(`/api/scheduled-tasks/${taskId}/runs`);
    const runsBeforeBody = await runsBefore.json();
    const runBefore = runsBeforeBody.find(
      (r: { id: string }) => r.id === chatId,
    );
    expect(runBefore).toBeTruthy();
    expect(runBefore.scheduledRunViewed).toBe(0);

    // View the run — response has a count that is a number ≥ 0.
    const viewRes1 = await request.post(
      `/api/scheduled-tasks/runs/${chatId}/view`,
    );
    const after1 = await viewRes1.json();
    expect(typeof after1.count).toBe('number');
    expect(after1.count).toBeGreaterThanOrEqual(0);

    // After viewing, the run chat is marked viewed.
    const runsAfter = await request.get(`/api/scheduled-tasks/${taskId}/runs`);
    const runsAfterBody = await runsAfter.json();
    const runAfter = runsAfterBody.find((r: { id: string }) => r.id === chatId);
    expect(runAfter).toBeTruthy();
    expect(runAfter.scheduledRunViewed).toBe(1);

    // Re-view same chatId — idempotent on the row state.
    await request.post(`/api/scheduled-tasks/runs/${chatId}/view`);
    const runsFinal = await request.get(`/api/scheduled-tasks/${taskId}/runs`);
    const runsFinalBody = await runsFinal.json();
    const runFinal = runsFinalBody.find((r: { id: string }) => r.id === chatId);
    expect(runFinal).toBeTruthy();
    expect(runFinal.scheduledRunViewed).toBe(1);
  });

  test('viewing a run flips only that run’s viewed flag', async ({
    request,
  }) => {
    // Seed two tasks, then run each. Both runs start unviewed.
    const taskA = await seedScheduledTask(request, { name: uniq('multi-a') });
    const taskB = await seedScheduledTask(request, { name: uniq('multi-b') });

    const runA = await request.post(`/api/scheduled-tasks/${taskA}/run`);
    const { chatId: chatA } = await runA.json();
    const runB = await request.post(`/api/scheduled-tasks/${taskB}/run`);
    const { chatId: chatB } = await runB.json();

    // The global unread count is shared with every other spec running in
    // parallel (it is non-monotonic as other runs are created), so assert only
    // on per-task state, which is fully isolated to the records we seeded.
    const viewedFlag = async (taskId: string, chatId: string) => {
      const body = await (
        await request.get(`/api/scheduled-tasks/${taskId}/runs`)
      ).json();
      return body.find((r: { id: string }) => r.id === chatId)
        ?.scheduledRunViewed;
    };

    // Both runs start unviewed.
    expect(await viewedFlag(taskA, chatA)).toBe(0);
    expect(await viewedFlag(taskB, chatB)).toBe(0);

    // Viewing chatA flips only chatA's flag; chatB stays unviewed.
    await request.post(`/api/scheduled-tasks/runs/${chatA}/view`);
    expect(await viewedFlag(taskA, chatA)).toBe(1);
    expect(await viewedFlag(taskB, chatB)).toBe(0);

    // Viewing chatB flips chatB; chatA remains viewed.
    await request.post(`/api/scheduled-tasks/runs/${chatB}/view`);
    expect(await viewedFlag(taskA, chatA)).toBe(1);
    expect(await viewedFlag(taskB, chatB)).toBe(1);
  });
});

test.describe('GET /api/scheduled-tasks/[id]/runs pagination', () => {
  test('respects limit and offset', async ({ request }) => {
    const taskId = await seedScheduledTask(request, { name: 'paged-runs' });

    // Run 3 times
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await request.post(`/api/scheduled-tasks/${taskId}/run`);
      ids.push((await r.json()).chatId);
    }
    // Most recent first, so ids are in reverse creation order

    // limit=2 returns the 2 most recent
    const page1 = await request.get(
      `/api/scheduled-tasks/${taskId}/runs?limit=2`,
    );
    const p1 = await page1.json();
    expect(p1).toHaveLength(2);
    expect(p1.map((r: { id: string }) => r.id)).toEqual([ids[2], ids[1]]);

    // offset=2 returns the third (oldest)
    const page2 = await request.get(
      `/api/scheduled-tasks/${taskId}/runs?limit=2&offset=2`,
    );
    const p2 = await page2.json();
    expect(p2).toHaveLength(1);
    expect(p2[0].id).toBe(ids[0]);
  });
});

test.describe('GET /api/scheduled-tasks/runs isolation-safe', () => {
  test('seeded runs appear with correct fields in filtered global list', async ({
    request,
  }) => {
    const task1 = await seedScheduledTask(request, { name: uniq('glob-a') });
    const task2 = await seedScheduledTask(request, { name: uniq('glob-b') });

    const r1 = await request.post(`/api/scheduled-tasks/${task1}/run`);
    const { chatId: c1 } = await r1.json();
    const r2 = await request.post(`/api/scheduled-tasks/${task2}/run`);
    const { chatId: c2 } = await r2.json();

    // Fetch with large limit; filter by own taskIds to avoid races.
    const res = await request.get('/api/scheduled-tasks/runs?limit=500');
    expect(res.status()).toBe(200);
    const allRuns: Array<{
      id: string;
      scheduledTaskId: string;
      taskName: string;
      preview: string;
      sourcesCount: number;
      scheduledRunViewed: number;
    }> = await res.json();

    const myIds = new Set([task1, task2]);
    const mine = allRuns.filter((r) => myIds.has(r.scheduledTaskId));

    // Both runs present.
    const ids = mine.map((r) => r.id);
    expect(ids).toContain(c1);
    expect(ids).toContain(c2);

    // Most recent first (c2 was created after c1).
    const idx1 = ids.indexOf(c1);
    const idx2 = ids.indexOf(c2);
    expect(idx2).toBeLessThan(idx1);

    // Fields populated.
    for (const entry of mine) {
      expect(typeof entry.taskName).toBe('string');
      expect(entry.taskName.length).toBeGreaterThan(0);
      expect(typeof entry.preview).toBe('string');
      expect(typeof entry.sourcesCount).toBe('number');
      expect(typeof entry.scheduledRunViewed).toBe('number');
    }
  });
});
