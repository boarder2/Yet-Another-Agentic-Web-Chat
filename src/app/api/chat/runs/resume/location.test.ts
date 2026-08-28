import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  class TestStaleSnapshotError extends Error {}
  class TestRaceError extends Error {}
  class TestRunGoneError extends Error {}
  return {
    resumeRun: vi.fn().mockResolvedValue(undefined),
    resumeRunMulti: vi.fn().mockResolvedValue(undefined),
    StaleSnapshotError: TestStaleSnapshotError,
    RaceError: TestRaceError,
    RunGoneError: TestRunGoneError,
  };
});

vi.mock('@/lib/runs/runHost', () => mocks);

import { POST } from './route';

beforeEach(() => {
  mocks.resumeRun.mockClear();
  mocks.resumeRunMulti.mockClear();
});

function request(body: unknown): Request {
  return new Request('http://localhost/api/chat/runs/resume', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('generic approval resume location boundary', () => {
  it('rejects coordinates and opaque location tokens from the entire generic resume payload', async () => {
    for (const body of [
      { approvalId: 'approval-1', response: { locationToken: 'a'.repeat(64) } },
      {
        approvalId: 'approval-1',
        response: { coordinates: { lat: 40.1234, lon: -75.5678 } },
      },
      {
        approvalId: 'approval-1',
        response: { nested: { latitude: 40.1234, longitude: -75.5678 } },
      },
      {
        approvalId: 'approval-1',
        coordinates: { lat: 40.1234, lon: -75.5678 },
      },
      { approvalId: 'approval-1', locationToken: 'a'.repeat(64) },
    ]) {
      const result = await POST(request(body));
      expect(result.status).toBe(400);
      expect(await result.json()).toMatchObject({
        error: expect.stringContaining('dedicated mapping endpoint'),
      });
    }
    expect(mocks.resumeRun).not.toHaveBeenCalled();
  });

  it('accepts only the coordinate-free location decision and passes it to the run host', async () => {
    const response = {
      approved: false,
      retention: 'once',
      reason: 'permission_denied',
      clientSessionId: 'page-1',
    };
    const result = await POST(request({ approvalId: 'approval-1', response }));

    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true });
    expect(mocks.resumeRun).toHaveBeenCalledWith('approval-1', response);
    expect(JSON.stringify(mocks.resumeRun.mock.calls)).not.toContain('40.1234');
  });

  it('rejects precise location hidden in a parallel resume map as well', async () => {
    const result = await POST(
      request({
        resumeMap: {
          'approval-1': { approved: true, retention: 'once' },
          'approval-2': { currentLocation: { lat: 40, lon: -75 } },
        },
      }),
    );

    expect(result.status).toBe(400);
    expect(mocks.resumeRunMulti).not.toHaveBeenCalled();
  });

  it('uses the keyed resume path for ordinary parallel approvals', async () => {
    const resumeMap = {
      'approval-1': { approved: true },
      'approval-2': { decision: 'accept' },
    };
    const result = await POST(request({ resumeMap }));

    expect(result.status).toBe(200);
    expect(mocks.resumeRunMulti).toHaveBeenCalledWith(resumeMap);
    expect(mocks.resumeRun).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON and missing approval identity before touching the host', async () => {
    const malformed = await POST(request('{not json'));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: 'Invalid JSON body' });

    const missing = await POST(request({ response: { approved: false } }));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({
      error: 'approvalId or resumeMap is required',
    });
  });
});
