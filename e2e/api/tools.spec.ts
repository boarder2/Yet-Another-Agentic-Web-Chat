import { test, expect } from '../fixtures/api';

test.describe('GET /api/tools', () => {
  test('returns a non-empty tools array', async ({ request }) => {
    const res = await request.get('/api/tools');
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(2);

    const names = body.map((t: { name: string }) => t.name);
    expect(names).toContain('timezone_converter');
    expect(names).toContain('date_difference');
  });

  test('each tool has exact name and description', async ({ request }) => {
    const res = await request.get('/api/tools');
    const body = await res.json();

    const byName: Record<string, string> = {};
    for (const tool of body) {
      byName[tool.name] = tool.description;
    }

    expect(byName['timezone_converter']).toBe(
      'Convert a date between timezones. Use IANA names (e.g. "Europe/London").',
    );
    expect(byName['date_difference']).toBe(
      'Difference between two dates (prefer ISO 8601).',
    );
  });
});
