import { z } from 'zod';
import { MapCoordinateSchema, type MapCoordinate } from './types';

/** Precise browser locations are usable only for the current turn. */
export const LOCATION_TOKEN_TTL_MS = 10 * 60 * 1000;
export const LOCATION_SESSION_TTL_MS = LOCATION_TOKEN_TTL_MS;

export const LOCATION_PURPOSES = ['nearby', 'routing', 'tiles'] as const;
export const LocationPurposeSchema = z.enum(LOCATION_PURPOSES);
export type LocationPurpose = (typeof LOCATION_PURPOSES)[number];

export const LOCATION_RETENTIONS = ['once', 'save'] as const;
export const LocationRetentionSchema = z.enum(LOCATION_RETENTIONS);
export type LocationRetention = (typeof LOCATION_RETENTIONS)[number];

export const LOCATION_DECLINE_REASONS = [
  'cancelled',
  'permission_denied',
  'unsupported',
  'timeout',
  'unavailable',
  'expired',
] as const;
export const LocationDeclineReasonSchema = z.enum(LOCATION_DECLINE_REASONS);
export type LocationDeclineReason = (typeof LOCATION_DECLINE_REASONS)[number];

const ClientSessionIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), {
    message: 'client session ID contains control characters',
  });
export { ClientSessionIdSchema };

/** Return the canonical page-session value used by every server boundary. */
export function normalizeClientSessionId(value: unknown): string | null {
  const parsed = ClientSessionIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function isSafeLocationHost(value: string): boolean {
  if (/\s|[\u0000-\u001f\u007f/\\]/.test(value)) return false;
  try {
    const parsed = new URL(`https://${value}`);
    return (
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.pathname === '/' &&
      parsed.search === '' &&
      parsed.hash === '' &&
      parsed.hostname.length > 0
    );
  } catch {
    return false;
  }
}

const HostSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(isSafeLocationHost, {
    message: 'location host is invalid',
  });

export const LocationHostListSchema = z
  .array(HostSchema)
  .max(32)
  .refine(
    (hosts) =>
      new Set(hosts.map((host) => host.toLowerCase())).size === hosts.length,
    {
      message: 'location hosts must be unique',
    },
  );

function sameHostSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const a = new Set(left.map((host) => host.toLowerCase()));
  const b = new Set(right.map((host) => host.toLowerCase()));
  return a.size === b.size && [...a].every((host) => b.has(host));
}

const COORDINATE_PAIR_PATTERN = new RegExp(
  `(?:^|[^\\d.])[+-]?(?:\\d{1,3}(?:\\.\\d+)?|\\.\\d+)\\s*(?:[,;]|\\s+)\\s*[+-]?(?:\\d{1,3}(?:\\.\\d+)?|\\.\\d+)(?=$|[^\\d.])`,
);

/** Reject coordinate-shaped text anywhere in approval metadata. */
export function containsCoordinateText(value: string): boolean {
  return COORDINATE_PAIR_PATTERN.test(value);
}

/** Safe, model-independent data shown by the location approval panel. */
export const LocationApprovalPayloadSchema = z
  .object({
    reason: z.string().trim().min(1).max(240).optional(),
    authorizedPurposes: z
      .array(LocationPurposeSchema)
      .min(1)
      .max(LOCATION_PURPOSES.length)
      .refine(
        (purposes) => new Set(purposes).size === purposes.length,
        'location purposes must be unique',
      ),
    authorizedHosts: LocationHostListSchema,
    /** Provider and tile splits are display-only and remain host names. */
    providerHosts: LocationHostListSchema,
    tileHosts: LocationHostListSchema,
    configHash: z.string().trim().min(1).max(2_000),
    clientSessionId: ClientSessionIdSchema,
    aiMessageId: z.string().trim().min(1).max(200),
    allowSave: z.boolean(),
    createdAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
  })
  .strict()
  .superRefine((payload, ctx) => {
    if (payload.expiresAt <= payload.createdAt) {
      ctx.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'location approval expiry must be after creation',
      });
    }
    if (payload.expiresAt - payload.createdAt > LOCATION_TOKEN_TTL_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'location approval expiry exceeds the ten-minute limit',
      });
    }
    if (
      !sameHostSet(payload.authorizedHosts, [
        ...payload.providerHosts,
        ...payload.tileHosts,
      ])
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['authorizedHosts'],
        message:
          'authorized hosts must include exactly the disclosed service hosts',
      });
    }
    if (payload.reason && containsCoordinateText(payload.reason)) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'location approval reason must not contain coordinates',
      });
    }
  });
export type LocationApprovalPayload = z.infer<
  typeof LocationApprovalPayloadSchema
>;

/** The only response shape that may be written to an approval row or stream. */
export const LocationApprovalResponseSchema = z
  .union([
    z
      .object({
        approved: z.literal(true),
        retention: LocationRetentionSchema,
      })
      .strict(),
    z
      .object({
        approved: z.literal(false),
        retention: z.literal('once'),
        reason: LocationDeclineReasonSchema.optional(),
        clientSessionId: ClientSessionIdSchema.optional(),
      })
      .strict(),
  ])
  .describe('Opaque location approval response');
export type LocationApprovalResponse = z.infer<
  typeof LocationApprovalResponseSchema
>;

/** Internal route→resume response. The token never crosses the generic API. */
export const LocationTokenResumeResponseSchema = z
  .object({
    locationToken: z
      .string()
      .trim()
      .min(32)
      .max(200)
      .regex(/^[A-Za-z0-9_-]+$/, 'location token is invalid'),
    retention: LocationRetentionSchema,
    clientSessionId: ClientSessionIdSchema,
  })
  .strict();
export type LocationTokenResumeResponse = z.infer<
  typeof LocationTokenResumeResponseSchema
>;

export const LocationResumeResponseSchema = z.union([
  LocationTokenResumeResponseSchema,
  LocationApprovalResponseSchema,
]);
export type LocationResumeResponse = z.infer<
  typeof LocationResumeResponseSchema
>;

export const BrowserLocationRequestSchema = z
  .object({
    approvalId: z.string().trim().min(1).max(200),
    clientSessionId: ClientSessionIdSchema,
    coordinates: MapCoordinateSchema.strict(),
    retention: LocationRetentionSchema,
  })
  .strict();
export type BrowserLocationRequest = z.infer<
  typeof BrowserLocationRequestSchema
>;

export type { MapCoordinate };
