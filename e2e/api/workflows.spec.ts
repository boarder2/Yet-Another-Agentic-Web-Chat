import { test, expect } from '../fixtures/api';
import { seedWorkflow, seedSchedule } from '../utils/seed';
import { uniq } from '../utils/helpers';

test.describe('POST /api/workflows', () => {
  test('creates a workflow with valid body', async ({ request }) => {
    const name = uniq('wf-create');
    const res = await request.post('/api/workflows', {
      data: {
        name,
        prompt: 'Research {{company}}',
        chatModel: { provider: 'test', name: 'test-direct' },
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(typeof body.id).toBe('string');
    expect(body.id.length).toBeGreaterThan(0);
    expect(body.name).toBe(name);
    expect(body.prompt).toBe('Research {{company}}');
    expect(body.focusMode).toBe('webSearch');
    expect(body.selectedSystemPromptIds).toEqual([]);
  });

  test('returns 400 when required fields are missing', async ({ request }) => {
    const res = await request.post('/api/workflows', {
      data: { name: uniq('no-prompt') },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: 'Missing required fields: name, prompt, chatModel',
    });
  });

  test('rejects save on bad placeholder grammar', async ({ request }) => {
    const res = await request.post('/api/workflows', {
      data: {
        name: uniq('bad-grammar'),
        prompt: 'Hello {{unclosed',
        chatModel: { provider: 'test', name: 'test-direct' },
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Invalid prompt template');
    expect(Array.isArray(body.parseErrors)).toBe(true);
    expect(body.parseErrors.length).toBeGreaterThan(0);
  });

  test('persists optional fields', async ({ request }) => {
    const res = await request.post('/api/workflows', {
      data: {
        name: uniq('opt-fields'),
        prompt: 'Do {{task}}',
        description: 'A test workflow',
        icon: 'Sparkles',
        focusMode: 'localResearch',
        chatModel: { provider: 'test', name: 'test-tool' },
        systemModel: { provider: 'test', name: 'test-direct' },
        selectedSystemPromptIds: ['sp-1'],
      },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.description).toBe('A test workflow');
    expect(body.icon).toBe('Sparkles');
    expect(body.focusMode).toBe('localResearch');
    expect(body.chatModel).toEqual({ provider: 'test', name: 'test-tool' });
    expect(body.systemModel).toEqual({ provider: 'test', name: 'test-direct' });
    expect(body.selectedSystemPromptIds).toEqual(['sp-1']);
  });
});

test.describe('GET /api/workflows', () => {
  test('returns an array and a seeded workflow appears in it', async ({
    request,
  }) => {
    const id = await seedWorkflow(request, { name: 'wf-list-test' });
    const res = await request.get('/api/workflows');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    const wf = body.find((w: { id: string }) => w.id === id);
    expect(wf).toBeTruthy();
    expect(wf.name).toBe('wf-list-test');
    expect(wf.running).toBe(false);
  });
});

test.describe('GET/PATCH/DELETE /api/workflows/[id]', () => {
  test('returns a workflow for a valid id, 404 otherwise', async ({
    request,
  }) => {
    const id = await seedWorkflow(request, { name: 'wf-get' });
    const res = await request.get(`/api/workflows/${id}`);
    expect(res.status()).toBe(200);
    expect((await res.json()).name).toBe('wf-get');

    const missing = await request.get(
      '/api/workflows/00000000-0000-0000-0000-000000000000',
    );
    expect(missing.status()).toBe(404);
    expect(await missing.json()).toEqual({ error: 'Not found' });
  });

  test('PATCH updates name and prompt', async ({ request }) => {
    const id = await seedWorkflow(request, { name: 'orig' });
    const res = await request.patch(`/api/workflows/${id}`, {
      data: { name: 'renamed', prompt: 'New {{topic}}' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('renamed');
    expect(body.prompt).toBe('New {{topic}}');
  });

  test('PATCH rejects a prompt with bad grammar', async ({ request }) => {
    const id = await seedWorkflow(request);
    const res = await request.patch(`/api/workflows/${id}`, {
      data: { prompt: '{{bad' },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).error).toBe('Invalid prompt template');
  });

  test('PATCH that invalidates a schedule fill-set auto-disables it', async ({
    request,
  }) => {
    // Workflow with no required inputs → schedule with empty fill-set is valid.
    const id = await seedWorkflow(request, { prompt: 'Static prompt' });
    const scheduleId = await seedSchedule(request, id, { label: 'sched-1' });

    // Sanity: schedule starts enabled.
    const before = await request.get(`/api/schedules/${scheduleId}`);
    expect((await before.json()).enabled).toBe(1);

    // Edit adds a required input the schedule's fill-set doesn't provide.
    const patch = await request.patch(`/api/workflows/${id}`, {
      data: { prompt: 'Report on {{company}}' },
    });
    expect(patch.status()).toBe(200);

    const after = await request.get(`/api/schedules/${scheduleId}`);
    const schedule = await after.json();
    expect(schedule.enabled).toBe(0);
    expect(schedule.disabledReason).toContain('company');
  });

  test('DELETE cascades schedules but keeps run chats (provenance nulled)', async ({
    request,
  }) => {
    const id = await seedWorkflow(request, { prompt: 'Say hello' });
    const scheduleId = await seedSchedule(request, id, { label: 'to-cascade' });

    // Produce a scheduled-run chat that must survive the delete.
    const runRes = await request.post(`/api/schedules/${scheduleId}/run`);
    expect(runRes.status()).toBe(200);
    const { chatId } = await runRes.json();

    const del = await request.delete(`/api/workflows/${id}`);
    expect(del.status()).toBe(200);
    expect(await del.json()).toEqual({
      success: true,
      deletedSchedules: 1,
    });

    // Workflow and schedule are gone.
    expect((await request.get(`/api/workflows/${id}`)).status()).toBe(404);
    expect((await request.get(`/api/schedules/${scheduleId}`)).status()).toBe(
      404,
    );

    // The run chat survives with its schedule provenance nulled.
    const chatRes = await request.get(`/api/chats/${chatId}`);
    expect(chatRes.status()).toBe(200);
    expect((await chatRes.json()).chat.scheduleId).toBeNull();
  });
});

test.describe('POST /api/workflows/[id]/run', () => {
  test('manual run seeds a continuable chat stamped with workflow_id', async ({
    request,
  }) => {
    const prompt = 'What is the capital of France?';
    const id = await seedWorkflow(request, { name: 'run-me', prompt });
    const res = await request.post(`/api/workflows/${id}/run`);
    expect(res.status()).toBe(201);
    const { chatId } = await res.json();
    expect(typeof chatId).toBe('string');

    const chatRes = await request.get(`/api/chats/${chatId}`);
    expect(chatRes.status()).toBe(200);
    const chatBody = await chatRes.json();
    expect(chatBody.chat.workflowId).toBe(id);
    // Manual chats are excluded from scheduled run-history (schedule_id null).
    expect(chatBody.chat.scheduleId).toBeNull();

    // First user message is the substituted prompt verbatim.
    const userMsg = chatBody.messages.find(
      (m: { role: string }) => m.role === 'user',
    );
    expect(userMsg.content).toBe(prompt);
  });

  test('substitutes fill-set values into the seeded prompt', async ({
    request,
  }) => {
    const id = await seedWorkflow(request, {
      name: 'sub-test',
      prompt: 'Research {{company}}',
    });
    const res = await request.post(`/api/workflows/${id}/run`, {
      data: { values: { company: 'Acme' } },
    });
    expect(res.status()).toBe(201);
    const { chatId } = await res.json();

    const chatBody = await (await request.get(`/api/chats/${chatId}`)).json();
    const userMsg = chatBody.messages.find(
      (m: { role: string }) => m.role === 'user',
    );
    expect(userMsg.content).toBe('Research Acme');
  });

  test('blocks a run missing a required input (server-side)', async ({
    request,
  }) => {
    const id = await seedWorkflow(request, {
      name: 'required-block',
      prompt: 'Research {{company}}',
    });
    const res = await request.post(`/api/workflows/${id}/run`, {
      data: { values: {} },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Missing required inputs');
    expect(body.missing).toContain('company');
  });

  test('returns 404 for a nonexistent workflow', async ({ request }) => {
    const res = await request.post(
      '/api/workflows/00000000-0000-0000-0000-000000000000/run',
    );
    expect(res.status()).toBe(404);
  });
});
