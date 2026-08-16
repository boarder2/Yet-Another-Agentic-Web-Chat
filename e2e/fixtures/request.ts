import type { APIRequestContext } from '@playwright/test';

const RETRIED_METHODS = new Set([
  'fetch',
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
]);

/**
 * A parallel run reuses keep-alive connections the dev server is simultaneously
 * closing, which surfaces as a one-off `ECONNRESET` on an otherwise healthy
 * request. Playwright's `maxRetries` retries that error and nothing else — no
 * HTTP status is ever retried, so a real 4xx/5xx still fails its spec.
 */
export function withConnectionRetries(
  request: APIRequestContext,
): APIRequestContext {
  return new Proxy(request, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== 'function' || !RETRIED_METHODS.has(String(property)))
        return value;
      return (url: string, options: Record<string, unknown> = {}) =>
        value.call(target, url, { maxRetries: 3, ...options });
    },
  });
}
