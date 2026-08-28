import { Document } from '@langchain/core/documents';
import { getCurrentTaskInput } from '@langchain/langgraph';
import { emitStreamEvent } from '@/lib/streaming/events';
import {
  MapPlaceSchema,
  MapSpecSchema,
  toPersistableMapSpec,
  type MapCoordinate,
  type MapPlace,
  type MapRoute,
  type MapSpec,
} from '@/lib/maps/types';
import { sanitizeMapError } from '@/lib/maps/request';
import type { MappingService } from '@/lib/maps/service';
import type {
  TurnMapPlaceRegistration,
  TurnMapRegistration,
  TurnMapRouteRegistration,
} from '@/lib/maps/turnMapRegistry';
import type { ToolContext } from '@/lib/tools/toolContext';
import type { DefineToolRuntime } from '@/lib/tools/defineTool';
import {
  getLocationSession,
  locationSessionIsUsable,
  type LocationPurpose,
} from '@/lib/maps/locationSessions';
import { mappingLocationHosts } from '@/lib/maps/config';
import { mappingConfigurationFingerprint } from '@/lib/maps/runtime';
import type { SimplifiedAgentStateType } from '@/lib/state/chatAgentState';

export type MappingToolRuntime = DefineToolRuntime;

const COORDINATE_NUMBER = '[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)';
const COORDINATE_TEXT = new RegExp(
  `^\\s*\\[?${COORDINATE_NUMBER}\\s*(?:,|;|\\s+)\\s*${COORDINATE_NUMBER}\\]?\\s*$`,
);

/** Named-location tools must not turn model-authored coordinate pairs into map data. */
export function looksLikeCoordinateText(value: string): boolean {
  return COORDINATE_TEXT.test(value);
}

/** Resolve a fresh facade when the runtime supplied one; otherwise use the test seam. */
export function currentMappingService(
  context: ToolContext,
): MappingService | null {
  if (context.mappingServiceResolver) {
    try {
      return context.mappingServiceResolver();
    } catch {
      return null;
    }
  }
  return context.mappingService ?? null;
}

export const CURRENT_LOCATION_NAMES = new Set([
  'current location',
  'my current location',
  'where i am',
  'near me',
]);

export const SAVED_LOCATION_NAMES = new Set([
  'saved location',
  'my saved location',
  'profile location',
  'my profile location',
]);

export function isCurrentLocationText(value: string): boolean {
  return CURRENT_LOCATION_NAMES.has(value.trim().toLowerCase());
}

export function isSavedLocationText(value: string): boolean {
  return SAVED_LOCATION_NAMES.has(value.trim().toLowerCase());
}

/** Resolve the approved browser location without exposing its coordinate. */
export function currentLocationForPurpose(
  context: ToolContext,
  purpose: LocationPurpose,
) {
  if (context.interactiveSession === false) return null;
  // A token is useful only with the complete run/message/page binding. Do not
  // let an optional field from a non-interactive context weaken that binding.
  if (
    !context.locationToken ||
    !context.clientSessionId ||
    !context.threadId ||
    !context.chatId ||
    !context.messageId ||
    !context.assistantMessageId
  ) {
    return null;
  }
  const config = context.mappingConfig;
  if (config && !config.available) return null;
  const requirements: import('@/lib/maps/locationSessions').LocationSessionRequirements =
    {
      purpose,
      binding: {
        runId: context.threadId,
        chatId: context.chatId,
        messageId: context.messageId,
        aiMessageId: context.assistantMessageId,
        clientSessionId: context.clientSessionId,
        ...(context.locationApprovalId
          ? { approvalId: context.locationApprovalId }
          : {}),
      },
    };
  if (config) {
    const hosts = mappingLocationHosts(config);
    requirements.authorizedHosts = hosts;
    requirements.configHash = mappingConfigurationFingerprint(config);
  }
  const session = getLocationSession(context.locationToken, requirements);
  if (session && context.isPrivate && session.retention === 'save') {
    return null;
  }
  return locationSessionIsUsable(session, purpose) ? session : null;
}

/** Hosts are disclosed to the approval UI, never endpoint URLs or credentials. */
export function mappingHostsForApproval(context: ToolContext): {
  authorizedHosts: string[];
  providerHosts: string[];
  tileHosts: string[];
} {
  const config = context.mappingConfig;
  if (!config) {
    return { authorizedHosts: [], providerHosts: [], tileHosts: [] };
  }
  const providerHosts = [
    ...(config.provider === 'test'
      ? []
      : [
          config.endpoints.geocoderUrl,
          config.endpoints.placesUrl,
          config.endpoints.routingUrl,
        ]),
  ]
    .map((url) => {
      try {
        return new URL(url).host.toLowerCase();
      } catch {
        return null;
      }
    })
    .filter((host): host is string => host !== null);
  const tileHosts = (() => {
    try {
      return [
        new URL(
          config.endpoints.tileUrl
            .replaceAll('{z}', '1')
            .replaceAll('{x}', '1')
            .replaceAll('{y}', '1'),
        ).host.toLowerCase(),
      ];
    } catch {
      return [];
    }
  })();
  const uniqueProviderHosts = [...new Set(providerHosts)];
  const uniqueTileHosts = [...new Set(tileHosts)];
  const authorizedHosts = [
    ...new Set([...uniqueProviderHosts, ...uniqueTileHosts]),
  ];
  // Keep the shared helper as the final source of endpoint host identity. The
  // explicit splits above exist only for the disclosure copy.
  const configuredHosts = mappingLocationHosts(config);
  return {
    authorizedHosts:
      configuredHosts.length > 0 ? configuredHosts : authorizedHosts,
    providerHosts: uniqueProviderHosts,
    tileHosts: uniqueTileHosts,
  };
}

export function mappingSignal(
  runtime: Pick<MappingToolRuntime, 'signal' | 'context'>,
): AbortSignal | undefined {
  return runtime.context.retrievalSignal ?? runtime.signal;
}

export function mappingUnavailable(): string {
  return 'Error: Mapping is unavailable for this turn. Continue without map data and do not infer locations.';
}

export function mappingToolError(error: unknown, signal?: AbortSignal): string {
  if (signal?.aborted) return 'Mapping operation was cancelled.';
  const safe = sanitizeMapError(error);
  return `Error: ${safe.message}`;
}

/** Publish precise origin/route data only to the approving page session. */
export function emitLocationOverlay(
  runtime: Pick<MappingToolRuntime, 'context'>,
  mapId: string,
  overlay: { origin?: MapCoordinate; route?: MapRoute },
): void {
  const session = currentLocationForPurpose(runtime.context, 'nearby');
  const routeSession = currentLocationForPurpose(runtime.context, 'routing');
  // A route overlay must be authorized by the routing purpose specifically;
  // nearby-only consent must never be widened by a caller-provided route.
  const locationSession = overlay.route ? routeSession : session;
  if (!locationSession || locationSession.retention !== 'once') return;
  if (!runtime.context.clientSessionId) return;
  emitStreamEvent(runtime.context.emitter, {
    type: 'map_session_overlay',
    data: {
      mapId,
      ...(overlay.origin ? { origin: overlay.origin } : {}),
      ...(overlay.route ? { route: overlay.route } : {}),
      clientSessionId: runtime.context.clientSessionId,
      expiresAt: new Date(locationSession.expiresAt).toISOString(),
    },
  });
}

export function currentDocumentCount(): number {
  try {
    const state = getCurrentTaskInput() as SimplifiedAgentStateType;
    return state.relevantDocuments?.length ?? 0;
  } catch {
    return 0;
  }
}

function optionalValue(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  if (value !== undefined && value !== null && value !== '') {
    target[key] = value;
  }
}

/** Deliberately omits provider IDs and coordinates from model-visible output. */
export function publicPlaceSummary(
  place: MapPlace,
  placeHandle: string,
): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    placeHandle,
    name: place.name,
    sourceUrl: place.sourceUrl,
    provider: place.provider,
  };
  optionalValue(summary, 'address', place.address);
  optionalValue(summary, 'category', place.category);
  optionalValue(summary, 'websiteUrl', place.websiteUrl);
  optionalValue(summary, 'phone', place.phone);
  optionalValue(summary, 'openingHours', place.openingHours);
  optionalValue(summary, 'rating', place.rating);
  optionalValue(summary, 'reviewCount', place.reviewCount);
  return summary;
}

function placeDocumentContent(place: MapPlace): string {
  const lines = [place.name];
  optionalValueAsLine(lines, 'Address', place.address);
  optionalValueAsLine(lines, 'Category', place.category);
  optionalValueAsLine(lines, 'Website', place.websiteUrl);
  optionalValueAsLine(lines, 'Phone', place.phone);
  optionalValueAsLine(lines, 'Opening hours', place.openingHours);
  optionalValueAsLine(lines, 'Rating', place.rating);
  optionalValueAsLine(lines, 'Review count', place.reviewCount);
  return lines.join('\n');
}

function optionalValueAsLine(
  lines: string[],
  label: string,
  value: unknown,
): void {
  if (value !== undefined && value !== null && value !== '') {
    lines.push(`${label}: ${String(value)}`);
  }
}

export function placeDocument(
  place: MapPlace,
  sourceId: number,
  searchQuery: string,
  placeHandle: string,
  options: { details?: boolean } = {},
): Document {
  return new Document({
    pageContent: placeDocumentContent(place),
    metadata: {
      sourceId,
      title: place.name,
      url: place.sourceUrl,
      source: place.sourceUrl,
      processingType: options.details
        ? 'mapping-place-details'
        : 'mapping-place',
      searchQuery,
      placeHandle,
      provider: place.provider,
    },
  });
}

export function routeDocument(
  route: MapRoute,
  sourceId: number,
  searchQuery: string,
  originName: string,
  destinationName: string,
  options: { hideExactLinks?: boolean } = {},
): Document {
  const mode = route.mode.charAt(0).toUpperCase() + route.mode.slice(1);
  const distance =
    route.distanceMeters < 1_000
      ? `${Math.round(route.distanceMeters)} m`
      : `${(route.distanceMeters / 1_000).toFixed(1)} km`;
  const minutes = Math.max(0, Math.round(route.durationSeconds / 60));
  const duration =
    minutes < 60
      ? `${minutes} min`
      : `${Math.floor(minutes / 60)} hr${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
  return new Document({
    pageContent: `${mode} route from ${originName} to ${destinationName}\nDistance: ${distance}\nEstimated duration: ${duration}`,
    metadata: {
      sourceId,
      title: `${originName} to ${destinationName}`,
      ...(options.hideExactLinks
        ? {}
        : { url: route.sourceUrl, source: route.sourceUrl }),
      processingType: 'mapping-route',
      searchQuery,
      provider: route.provider,
    },
  });
}

export function registerMapSpec(
  runtime: Pick<MappingToolRuntime, 'context'>,
  spec: MapSpec,
  source: string,
  options: { retainRoute?: boolean; retainOrigin?: boolean } = {},
): TurnMapRegistration | null {
  const parsed = MapSpecSchema.safeParse(spec);
  if (!parsed.success) return null;
  const routingLocation = currentLocationForPurpose(runtime.context, 'routing');
  const nearbyLocation = currentLocationForPurpose(runtime.context, 'nearby');
  const transientLocation = routingLocation ?? nearbyLocation;
  // A transient browser-origin map is useful to the approving page only. Keep
  // precise origin/route data redacted in the registry and writer event; the
  // route/origin travels separately through the live session overlay. Explicit
  // options preserve that decision even if the token expires between the
  // provider response and this registration.
  const registrySpec = toPersistableMapSpec(parsed.data, {
    retainRoute: options.retainRoute ?? transientLocation?.retention !== 'once',
    retainOrigin:
      options.retainOrigin ?? transientLocation?.retention !== 'once',
  });
  const registry = runtime.context.mapRegistry;
  const snapshot = registry.snapshot();
  try {
    const registration = registry.register(registrySpec);
    emitStreamEvent(runtime.context.emitter, {
      type: 'map_spec',
      data: {
        mapId: registration.mapId,
        handle: registration.handle,
        spec: registration.spec,
        source,
      },
    });
    return registration;
  } catch {
    try {
      registry.restore(snapshot);
    } catch {
      // A failed rollback must not turn a map lookup into a chat failure.
    }
    return null;
  }
}

export function registerPlaces(
  runtime: Pick<MappingToolRuntime, 'context'>,
  places: MapPlace[],
  options?: { mapHandle?: string; mapId?: string },
): TurnMapPlaceRegistration[] {
  return runtime.context.mapRegistry.registerPlaces(places, options);
}

export function registerRoute(
  runtime: Pick<MappingToolRuntime, 'context'>,
  route: MapRoute,
  options?: { mapHandle?: string; mapId?: string },
): TurnMapRouteRegistration {
  return runtime.context.mapRegistry.registerRoute(route, options);
}

export function routePublicSummary(
  route: MapRoute,
  originName: string,
  destinationName: string,
  routeHandle?: string,
  mapHandle?: string,
  options: { hideExactLinks?: boolean } = {},
): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    origin: originName,
    destination: destinationName,
    mode: route.mode,
    distanceMeters: route.distanceMeters,
    durationSeconds: route.durationSeconds,
    ...(options.hideExactLinks
      ? { navigationLink: 'Available in the inline map for this page session.' }
      : { sourceUrl: route.sourceUrl, navigationUrl: route.navigationUrl }),
    provider: route.provider,
    attribution: route.attribution,
  };
  optionalValue(summary, 'routeHandle', routeHandle);
  optionalValue(summary, 'mapHandle', mapHandle);
  return summary;
}

export function placeByHandle(
  runtime: Pick<MappingToolRuntime, 'context'>,
  handle: string,
): TurnMapPlaceRegistration | undefined {
  return runtime.context.mapRegistry.resolvePlace(handle);
}

export function mapForHandle(
  runtime: Pick<MappingToolRuntime, 'context'>,
  handle: string,
): TurnMapRegistration | undefined {
  const direct = runtime.context.mapRegistry.resolve(handle);
  if (direct) return direct;
  const route = runtime.context.mapRegistry.resolveRoute(handle);
  if (!route?.mapHandle) return undefined;
  return runtime.context.mapRegistry.resolve(route.mapHandle);
}

export function outputPlace(
  place: MapPlace,
  handle: string,
): Record<string, unknown> {
  return publicPlaceSummary(MapPlaceSchema.parse(place), handle);
}
