import {
  resumeRun,
  resumeRunMulti,
  StaleSnapshotError,
  RaceError,
  RunGoneError,
} from '@/lib/runs/runHost';
import { containsCoordinateText } from '@/lib/maps/locationSessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Browser coordinates and location tokens belong to the dedicated mapping
 * boundary; neither may enter the generic approval resume payload. */
function numericCoordinate(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function looksLikeCoordinatePair(value: unknown): boolean {
  if (!Array.isArray(value) || value.length !== 2) return false;
  const first = numericCoordinate(value[0]);
  const second = numericCoordinate(value[1]);
  return (
    first !== null &&
    second !== null &&
    ((first >= -180 && first <= 180 && second >= -90 && second <= 90) ||
      (first >= -90 && first <= 90 && second >= -180 && second <= 180))
  );
}

const COORDINATE_TEXT =
  /^\s*\[?([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*(?:,|;|\s+)\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\]?\s*$/;

function looksLikeCoordinateText(value: string): boolean {
  const match = value.match(COORDINATE_TEXT);
  if (!match) return false;
  const first = Number(match[1]);
  const second = Number(match[2]);
  return (
    Number.isFinite(first) &&
    Number.isFinite(second) &&
    ((first >= -180 && first <= 180 && second >= -90 && second <= 90) ||
      (first >= -90 && first <= 90 && second >= -180 && second <= 180))
  );
}

function containsPreciseLocation(value: unknown): boolean {
  if (typeof value === 'string') {
    return looksLikeCoordinateText(value) || containsCoordinateText(value);
  }
  if (Array.isArray(value)) {
    return (
      looksLikeCoordinatePair(value) || value.some(containsPreciseLocation)
    );
  }
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  const locationKeys = new Set(
    Object.keys(record).map((key) =>
      key.toLowerCase().replace(/[^a-z0-9]/g, ''),
    ),
  );
  if (
    locationKeys.has('locationtoken') ||
    locationKeys.has('coordinates') ||
    locationKeys.has('latitude') ||
    locationKeys.has('longitude') ||
    locationKeys.has('long') ||
    locationKeys.has('browsercoordinates') ||
    locationKeys.has('currentlocation') ||
    (locationKeys.has('lat') &&
      (locationKeys.has('lon') || locationKeys.has('lng')))
  ) {
    return true;
  }
  return Object.values(record).some(containsPreciseLocation);
}

export async function POST(req: Request) {
  try {
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      return Response.json(
        { error: 'Invalid resume request' },
        { status: 400 },
      );
    }
    const body = rawBody as {
      approvalId?: unknown;
      response?: unknown;
      resumeMap?: unknown;
    };

    // Inspect the complete request, not only the two supported response
    // fields. Unknown top-level fields must not become a side channel for a
    // browser coordinate or bearer token.
    if (containsPreciseLocation(rawBody)) {
      return Response.json(
        {
          error:
            'Browser location must be submitted through the dedicated mapping endpoint',
        },
        { status: 400 },
      );
    }

    // Parallel interrupts: { resumeMap: { approvalId: response, ... } }
    const resumeMap =
      body.resumeMap &&
      typeof body.resumeMap === 'object' &&
      !Array.isArray(body.resumeMap)
        ? (body.resumeMap as Record<string, unknown>)
        : undefined;
    if (resumeMap && Object.keys(resumeMap).length > 0) {
      await resumeRunMulti(resumeMap);
      return Response.json({ ok: true });
    }

    if (typeof body.approvalId !== 'string' || !body.approvalId.trim()) {
      return Response.json(
        { error: 'approvalId or resumeMap is required' },
        { status: 400 },
      );
    }

    await resumeRun(body.approvalId.trim(), body.response ?? null);
    return Response.json({ ok: true });
  } catch (err) {
    if (err instanceof RaceError) {
      return Response.json({ error: (err as Error).message }, { status: 409 });
    }
    if (err instanceof StaleSnapshotError) {
      return Response.json({ error: (err as Error).message }, { status: 409 });
    }
    if (err instanceof RunGoneError) {
      return Response.json({ error: (err as Error).message }, { status: 410 });
    }
    console.error('[/api/chat/runs/resume] error:', err);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
}
