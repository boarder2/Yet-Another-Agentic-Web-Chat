import { test, expect } from '../fixtures/api';

test.describe('GET /api/opensearch', () => {
  test('returns XML with correct Content-Type', async ({ request }) => {
    const res = await request.get('/api/opensearch');
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toBe(
      'application/opensearchdescription+xml',
    );
  });

  test('contains OpenSearchDescription root and ShortName', async ({
    request,
  }) => {
    const res = await request.get('/api/opensearch');
    expect(res.status()).toBe(200);
    const xml = await res.text();

    expect(xml).toContain('<OpenSearchDescription');
    expect(xml).toContain('xmlns="http://a9.com/-/spec/opensearch/1.1/"');
    expect(xml).toContain('<ShortName>YAAWC</ShortName>');
  });

  test('contains Url template for web search results', async ({ request }) => {
    const res = await request.get('/api/opensearch');
    expect(res.status()).toBe(200);
    const xml = await res.text();

    expect(xml).toContain('type="text/html"');
    expect(xml).toContain('/?q={searchTerms}');
  });

  test('contains Url template for suggestions', async ({ request }) => {
    const res = await request.get('/api/opensearch');
    expect(res.status()).toBe(200);
    const xml = await res.text();

    expect(xml).toContain('rel="suggestions"');
    expect(xml).toContain('type="application/x-suggestions+json"');
    expect(xml).toContain('/api/autocomplete?q={searchTerms}');
  });
});

test.describe('GET /api/opensearch — origin detection', () => {
  test('uses configured BASE_URL as template origin', async ({ request }) => {
    const res = await request.get('/api/opensearch');
    expect(res.status()).toBe(200);
    const xml = await res.text();

    // BASE_URL is configured in test env; templates use it, not the request origin.
    expect(xml).toContain('localhost:3000/?q={searchTerms}');
    expect(xml).toContain('localhost:3000/api/autocomplete?q={searchTerms}');
    expect(xml).toContain('localhost:3000/api/opensearch');
  });

  test('ignores X-Forwarded-* headers when BASE_URL is set', async ({
    request,
  }) => {
    const res = await request.get('/api/opensearch', {
      headers: {
        'X-Forwarded-Host': 'evil.example.com',
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Port': '8443',
      },
    });
    expect(res.status()).toBe(200);
    const xml = await res.text();

    // BASE_URL takes precedence — forwarded headers are ignored.
    expect(xml).toContain('localhost:3000/?q={searchTerms}');
    expect(xml).not.toContain('evil.example.com');
  });
});
