import { z } from 'zod';

/**
 * The "now" an LLM is told about: an instant plus the IANA zone it is read in.
 * Interactive requests carry the browser's clock in these headers; headless
 * runs use a schedule's zone. Persisted timestamps never use this — they stay
 * server UTC.
 */
export const CURRENT_DATE_HEADER = 'X-Current-Date';
export const TIMEZONE_HEADER = 'X-Timezone';

const isoInstant = z.iso.datetime({ offset: true });

export const runClockSchema = z
  .object({ now: isoInstant, timeZone: z.string() })
  .strict();
export type RunClock = z.infer<typeof runClockSchema>;

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** This process's clock and zone — the server's on the server, the browser's in it. */
export function localClock(now: Date = new Date()): RunClock {
  return {
    now: now.toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

/** The current instant read in `timeZone`, or the local zone when it is unset or invalid. */
export function clockInZone(
  timeZone: string | null | undefined,
  now: Date = new Date(),
): RunClock {
  const clock = localClock(now);
  return timeZone && isValidTimeZone(timeZone) ? { ...clock, timeZone } : clock;
}

/**
 * The clock a request's browser sent. Each header falls back to the server's
 * own value independently, so old tabs and API scripts keep working.
 */
export function getRequestClock(req: Request): RunClock {
  // `Date.parse` alone accepts "1" and rolls Feb 30 into March.
  const sentAt = isoInstant.safeParse(req.headers.get(CURRENT_DATE_HEADER));
  return clockInZone(
    req.headers.get(TIMEZONE_HEADER),
    sentAt.success ? new Date(sentAt.data) : undefined,
  );
}

/**
 * A Date whose UTC fields hold the clock's wall time in its zone, so callers
 * can do calendar math and read fields with the `getUTC*`/`setUTC*` methods.
 */
export function wallClock(clock: RunClock): Date {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: clock.timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(clock.now))
      .map((p) => [p.type, Number(p.value)]),
  );
  return new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    ),
  );
}

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO 8601 local time with the zone's offset, e.g. `2026-10-03T14:30:00-07:00`. */
export function localIsoString(clock: RunClock): string {
  const wall = wallClock(clock);
  const offsetMin = Math.round(
    (wall.getTime() - Math.floor(Date.parse(clock.now) / 1000) * 1000) / 60000,
  );
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  return `${wall.toISOString().slice(0, 19)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** The prompt's date line — no time of day, so the prompt only changes daily. */
export function formatDateForLLM(clock: RunClock): string {
  const date = new Date(clock.now).toLocaleDateString('en-US', {
    timeZone: clock.timeZone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return `${date} (${clock.timeZone})`;
}
