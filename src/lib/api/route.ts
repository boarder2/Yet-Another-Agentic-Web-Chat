/**
 * Server-side route plumbing: one try/catch, one log, one error shape.
 *
 * Handlers throw `HttpError` for expected failures and let anything else
 * bubble — `route` maps the former to its status and the latter to a logged
 * 500. Bodies are always `{ error }`, which is what `apiFetch` reads.
 */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string, extra?: Record<string, unknown>) =>
  new HttpError(400, message, extra);

export const notFound = (message = 'Not found') => new HttpError(404, message);

/**
 * Wraps a route handler. `fallback` is the 500 message and doubles as the log
 * label, so each route still names its own failure.
 */
export function route<A extends unknown[]>(
  fallback: string,
  handler: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof HttpError) {
        return Response.json(
          { error: err.message, ...err.extra },
          { status: err.status },
        );
      }
      console.error(`${fallback}:`, err);
      return Response.json({ error: fallback }, { status: 500 });
    }
  };
}
