import { describe, expect, it } from 'vitest';
import {
  CURRENT_DATE_HEADER,
  TIMEZONE_HEADER,
  formatDateForLLM,
  getRequestClock,
  localIsoString,
} from './clock';

const serverZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

const request = (headers: Record<string, string>) =>
  new Request('http://localhost/api/chat', { headers });

describe('getRequestClock', () => {
  it("reads the browser's instant and zone", () => {
    expect(
      getRequestClock(
        request({
          [CURRENT_DATE_HEADER]: '2026-10-03T23:30:00-07:00',
          [TIMEZONE_HEADER]: 'America/Los_Angeles',
        }),
      ),
    ).toEqual({
      now: '2026-10-04T06:30:00.000Z',
      timeZone: 'America/Los_Angeles',
    });
  });

  it('falls back to the server clock and zone without headers', () => {
    const before = Date.now();
    const clock = getRequestClock(request({}));
    expect(Date.parse(clock.now)).toBeGreaterThanOrEqual(before);
    expect(clock.timeZone).toBe(serverZone);
  });

  it('falls back on dates that are not ISO instants with an offset', () => {
    for (const sent of ['1', '2026-02-30T12:00:00Z', '2026-10-03T23:30:00']) {
      const before = Date.now();
      const clock = getRequestClock(
        request({
          [CURRENT_DATE_HEADER]: sent,
          [TIMEZONE_HEADER]: 'Asia/Tokyo',
        }),
      );
      expect(Date.parse(clock.now)).toBeGreaterThanOrEqual(before);
      expect(clock.timeZone).toBe('Asia/Tokyo');
    }
  });

  it('falls back per header', () => {
    const badDate = getRequestClock(
      request({
        [CURRENT_DATE_HEADER]: 'yesterday-ish',
        [TIMEZONE_HEADER]: 'Asia/Tokyo',
      }),
    );
    expect(Date.parse(badDate.now)).not.toBeNaN();
    expect(badDate.timeZone).toBe('Asia/Tokyo');

    expect(
      getRequestClock(
        request({
          [CURRENT_DATE_HEADER]: '2026-10-03T12:00:00Z',
          [TIMEZONE_HEADER]: 'Mars/Olympus_Mons',
        }),
      ),
    ).toEqual({ now: '2026-10-03T12:00:00.000Z', timeZone: serverZone });
  });
});

describe('formatDateForLLM', () => {
  it("names the calendar day in the clock's zone, not UTC", () => {
    // 03:30 UTC on Oct 4 is still the evening of Oct 3 in New York.
    expect(
      formatDateForLLM({
        now: '2026-10-04T03:30:00Z',
        timeZone: 'America/New_York',
      }),
    ).toBe('Saturday, October 3, 2026 (America/New_York)');
  });
});

describe('localIsoString', () => {
  it("renders wall time with the zone's offset", () => {
    expect(
      localIsoString({
        now: '2026-10-04T04:30:15.250Z',
        timeZone: 'America/New_York',
      }),
    ).toBe('2026-10-04T00:30:15-04:00');
    expect(
      localIsoString({ now: '2026-01-15T12:00:00Z', timeZone: 'Asia/Kolkata' }),
    ).toBe('2026-01-15T17:30:00+05:30');
    expect(
      localIsoString({ now: '2026-01-15T12:00:00Z', timeZone: 'UTC' }),
    ).toBe('2026-01-15T12:00:00+00:00');
  });
});
