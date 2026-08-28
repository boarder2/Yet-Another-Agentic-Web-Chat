import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { approvalRequests, chats } from '@/lib/db/schema';
import {
  BrowserLocationRequestSchema,
  isLocationApprovalExpired,
  isLocationApprovalWindowBounded,
  LOCATION_TOKEN_TTL_MS,
  LocationApprovalPayloadSchema,
  isValidClientSessionId,
  locationHostsMatch,
  mintLocationToken,
  revokeLocationToken,
  type LocationApprovalPayload,
} from '@/lib/maps/locationSessions';
import { getMappingConfiguration } from '@/lib/settings/server';
import { mappingLocationHosts } from '@/lib/maps/config';
import { mappingConfigurationFingerprint } from '@/lib/maps/runtime';
import {
  markLocationApprovalStale,
  resumeLocationApprovalStale,
  resumeRun,
  RaceError,
  RunGoneError,
  StaleSnapshotError,
} from '@/lib/runs/runHost';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function payloadForApproval(value: unknown): LocationApprovalPayload | null {
  const parsed = LocationApprovalPayloadSchema.safeParse(value);
  if (!parsed.success) return null;
  if (
    parsed.data.expiresAt <= parsed.data.createdAt ||
    parsed.data.expiresAt - parsed.data.createdAt > 10 * 60 * 1000 ||
    !isLocationApprovalWindowBounded(parsed.data)
  ) {
    return null;
  }
  return parsed.data;
}

/**
 * Accept the browser coordinate only at the dedicated location boundary. The
 * coordinate is immediately moved into the process-local token store; this
 * route never returns, persists, or logs it.
 */
export async function POST(req: Request) {
  let token: string | undefined;
  let approvalId: string | undefined;
  try {
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return errorResponse('Invalid browser location request', 400);
    }
    const parsedBody = BrowserLocationRequestSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      return errorResponse('Invalid browser location request', 400);
    }
    const body = parsedBody.data;
    approvalId = body.approvalId;
    if (!isValidClientSessionId(body.clientSessionId)) {
      return errorResponse('Invalid page session', 400);
    }

    const approval = await db.query.approvalRequests.findFirst({
      where: eq(approvalRequests.id, body.approvalId),
    });
    if (
      !approval ||
      approval.toolKind !== 'location' ||
      !approval.engineInterruptId ||
      !approval.toolCallId
    ) {
      return errorResponse('Location approval was not found', 404);
    }
    if (approval.resolvedAt != null) {
      return errorResponse('Location approval is no longer pending', 409);
    }
    // Pending location rows are coordinate-free by construction. A legacy or
    // tampered row with durable state must be closed before it can be used.
    if (approval.snapshot != null || approval.response != null) {
      await resumeLocationApprovalStale(
        approval.id,
        'Location approval contains invalid durable data.',
      ).catch(() =>
        markLocationApprovalStale(
          approval.id,
          'Location approval contains invalid durable data.',
        ),
      );
      return errorResponse(
        'Location approval is invalid or expired; ask for a named origin instead.',
        409,
      );
    }

    const payload = payloadForApproval(approval.payload);
    if (!payload) {
      await resumeLocationApprovalStale(
        approval.id,
        'Location approval data is invalid or expired.',
      ).catch(() =>
        markLocationApprovalStale(
          approval.id,
          'Location approval data is invalid or expired.',
        ),
      );
      return errorResponse(
        'Location approval is invalid or expired; ask for a named origin instead.',
        409,
      );
    }
    if (isLocationApprovalExpired(payload)) {
      await resumeLocationApprovalStale(
        approval.id,
        'Location approval expired; ask for a named origin instead.',
      ).catch(() =>
        markLocationApprovalStale(
          approval.id,
          'Location approval expired; ask for a named origin instead.',
        ),
      );
      return errorResponse(
        'Location approval expired; ask for a named origin instead.',
        409,
      );
    }
    if (body.clientSessionId !== payload.clientSessionId) {
      return errorResponse(
        'Location approval belongs to another page session',
        403,
      );
    }

    const chat = await db.query.chats.findFirst({
      where: eq(chats.id, approval.chatId),
    });
    if (
      !chat ||
      chat.activeRunMessageId !== approval.messageId ||
      chat.activeRunThreadId !== approval.threadId ||
      chat.activeRunStatus !== 'awaiting_user'
    ) {
      return errorResponse('The location run is no longer active', 410);
    }
    if (
      body.retention === 'save' &&
      (!payload.allowSave || chat.isPrivate === 1)
    ) {
      return errorResponse(
        'Saving a precise route is unavailable in this chat',
        400,
      );
    }

    let config;
    try {
      config = getMappingConfiguration();
    } catch {
      await resumeLocationApprovalStale(
        approval.id,
        'Mapping configuration is unavailable; ask for a named origin instead.',
      ).catch(() =>
        markLocationApprovalStale(
          approval.id,
          'Mapping configuration is unavailable; ask for a named origin instead.',
        ),
      );
      return errorResponse(
        'Mapping configuration is unavailable; ask for a named origin instead.',
        409,
      );
    }
    const currentHosts = mappingLocationHosts(config);
    if (
      !config.available ||
      mappingConfigurationFingerprint(config) !== payload.configHash ||
      !locationHostsMatch(payload.authorizedHosts, currentHosts)
    ) {
      await resumeLocationApprovalStale(
        approval.id,
        'Mapping configuration changed while location approval was pending.',
      ).catch(() =>
        markLocationApprovalStale(
          approval.id,
          'Mapping configuration changed while location approval was pending.',
        ),
      );
      return errorResponse(
        'Mapping configuration changed; ask for a named origin instead.',
        409,
      );
    }

    const now = Date.now();
    if (isLocationApprovalExpired(payload, now)) {
      await resumeLocationApprovalStale(
        approval.id,
        'Location approval expired; ask for a named origin instead.',
      ).catch(() =>
        markLocationApprovalStale(
          approval.id,
          'Location approval expired; ask for a named origin instead.',
        ),
      );
      return errorResponse(
        'Location approval expired; ask for a named origin instead.',
        409,
      );
    }
    const remainingApprovalMs = payload.expiresAt - now;
    // The approval can cross its expiry boundary between the initial row check
    // and minting. Do not leave a pending row behind with a token allocation
    // failure; close it through the same coordinate-free stale path.
    if (remainingApprovalMs < 1) {
      await resumeLocationApprovalStale(
        approval.id,
        'Location approval expired; ask for a named origin instead.',
      ).catch(() =>
        markLocationApprovalStale(
          approval.id,
          'Location approval expired; ask for a named origin instead.',
        ),
      );
      return errorResponse(
        'Location approval expired; ask for a named origin instead.',
        409,
      );
    }
    const session = mintLocationToken({
      coordinate: body.coordinates,
      binding: {
        approvalId: approval.id,
        runId: approval.threadId,
        chatId: approval.chatId,
        messageId: approval.messageId,
        aiMessageId: payload.aiMessageId,
        clientSessionId: body.clientSessionId,
      },
      authorizedPurposes: payload.authorizedPurposes,
      authorizedHosts: payload.authorizedHosts,
      configHash: payload.configHash,
      retention: body.retention,
      now,
      ttlMs: Math.min(LOCATION_TOKEN_TTL_MS, remainingApprovalMs),
    });
    token = session.token;

    await resumeRun(approval.id, {
      locationToken: session.token,
      retention: body.retention,
      clientSessionId: body.clientSessionId,
    });

    // The opaque token is intentionally not returned to the browser. The page
    // receives the exact route only through the session-scoped live stream.
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (token) revokeLocationToken(token);
    if (error instanceof StaleSnapshotError) {
      const staleApprovalId = approvalId;
      if (staleApprovalId) {
        await resumeLocationApprovalStale(
          staleApprovalId,
          'Location approval is no longer valid; ask for a named origin instead.',
        )
          .catch(() =>
            markLocationApprovalStale(
              staleApprovalId,
              'Location approval is no longer valid; ask for a named origin instead.',
            ),
          )
          .catch(() => undefined);
      }
      return errorResponse(
        'Location approval is no longer valid; ask for a named origin instead.',
        409,
      );
    }
    if (error instanceof RaceError) {
      return errorResponse(
        'Location approval is no longer pending; ask for a named origin instead.',
        409,
      );
    }
    if (error instanceof RunGoneError) {
      return errorResponse(
        'The location run is no longer active; ask for a named origin instead.',
        410,
      );
    }
    return errorResponse(
      'The location approval could not be completed; ask for a named origin instead.',
      400,
    );
  }
}
