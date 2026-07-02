let _counter = 0;

export function uid(): string {
  return crypto.randomUUID();
}

export function uniq(prefix: string): string {
  _counter++;
  return `${prefix}-${Date.now()}-${_counter}`;
}

/** Mirrors playwright.config.ts's BASE_URL resolution, for helpers that need
 * a raw fetch (partial-read streaming) instead of the `request` fixture. */
export function baseURL(): string {
  const port = process.env.PORT ?? '5005';
  return process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${port}`;
}
