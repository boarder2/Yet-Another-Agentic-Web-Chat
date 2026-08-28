import type { MapPayload } from '@/lib/widgets/envelope';
import {
  MapAttributionSchema,
  MapSafeUrlSchema,
  PersistableMapSpecSchema,
  mapSpecAttributions,
  type MapRoute,
  type PersistableMapSpec,
} from './types';

const MAX_FALLBACK_LENGTH = 4_000;
const MAX_LINKS = 40;

function formatDistance(distanceMeters: number): string {
  if (distanceMeters < 1_000) return `${Math.round(distanceMeters)} m`;
  const kilometres = distanceMeters / 1_000;
  return `${kilometres < 10 ? kilometres.toFixed(1) : Math.round(kilometres)} km`;
}

function formatDuration(durationSeconds: number): string {
  const minutes = Math.max(0, Math.round(durationSeconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining === 0 ? `${hours} hr` : `${hours} hr ${remaining} min`;
}

/** Return every validated attribution in the order it was first used. */
export function formatMapAttributions(value: PersistableMapSpec): string[] {
  const spec = PersistableMapSpecSchema.parse(value);
  return mapSpecAttributions(spec);
}

function routeNotRetained(spec: PersistableMapSpec): boolean {
  return (
    spec.routeNotRetained === true ||
    (spec.route !== undefined && 'routeNotRetained' in spec.route)
  );
}

export function formatMapRouteSummary(
  route: Pick<MapRoute, 'mode' | 'distanceMeters' | 'durationSeconds'>,
): string {
  const mode = route.mode.charAt(0).toUpperCase() + route.mode.slice(1);
  return `${mode} route: ${formatDistance(route.distanceMeters)}, about ${formatDuration(route.durationSeconds)}.`;
}

function safeLabel(value: string): string {
  return (
    value
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/[\[\]()`*_<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240) || 'Map link'
  );
}

function safeFallbackText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/```/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function safeUrl(value: string): string | null {
  return MapSafeUrlSchema.safeParse(value).success ? value : null;
}

/**
 * Build the semantic, map-independent text that remains useful when Leaflet,
 * tiles, or JavaScript are unavailable. Coordinates are never included in this
 * presentation; the provider-grounded place links are the external anchors.
 */
export function formatMapSpecFallback(value: PersistableMapSpec): string {
  const parsed = PersistableMapSpecSchema.parse(value);
  const lines: string[] = [];
  const title = parsed.title ? safeFallbackText(parsed.title) : '';
  const summary = parsed.summary ? safeFallbackText(parsed.summary) : '';
  if (title) lines.push(title);
  if (summary) lines.push(summary);

  parsed.places.forEach((place, index) => {
    const name = safeFallbackText(place.name) || 'Unnamed place';
    const address = place.address ? safeFallbackText(place.address) : '';
    lines.push(`${index + 1}. ${name}${address ? ` — ${address}` : ''}`);
  });
  if (parsed.origin) {
    lines.push(
      'Current location is shown on the map and saved in this answer only.',
    );
  }

  if (parsed.route && !('routeNotRetained' in parsed.route)) {
    lines.push(formatMapRouteSummary(parsed.route));
  } else if (routeNotRetained(parsed)) {
    lines.push('Route not retained.');
  }

  const attributions = formatMapAttributions(parsed);
  if (attributions.length > 1) {
    lines.push(`Attribution: ${attributions.join(' · ')}`);
  }

  if (lines.length === 0) lines.push('Validated map data is available.');
  lines.push(`Retrieved: ${parsed.retrievedAt}`);
  return lines.join('\n').slice(0, MAX_FALLBACK_LENGTH);
}

/** Collect validated external links without exposing map internals. */
export function mapSpecLinks(
  value: PersistableMapSpec,
  routeOverride?: MapRoute,
): Array<{
  label: string;
  url: string;
}> {
  const parsed = PersistableMapSpecSchema.parse(value);
  const links: Array<{ label: string; url: string }> = [];
  const add = (label: string, url: string | undefined) => {
    if (links.length >= MAX_LINKS || !url) return;
    const safe = safeUrl(url);
    if (!safe || links.some((link) => link.url === safe)) return;
    links.push({ label: safeLabel(label), url: safe });
  };

  parsed.places.forEach((place, index) => {
    add(`${index + 1}. ${place.name}`, place.sourceUrl);
    if (place.websiteUrl) add(`${place.name} website`, place.websiteUrl);
  });
  const route = routeOverride ?? parsed.route;
  if (route && !('routeNotRetained' in route)) {
    add('Open route', route.navigationUrl);
    add('Route source', route.sourceUrl);
  }
  return links;
}

/** Convert a validated persisted spec into the writer-owned envelope payload. */
export function mapSpecToPayload(
  mapId: string,
  placementId: string,
  value: PersistableMapSpec,
): MapPayload {
  const spec = PersistableMapSpecSchema.parse(value);
  const attributions = formatMapAttributions(spec);
  const attribution = MapAttributionSchema.parse(spec.attribution);
  const title = spec.title ? safeFallbackText(spec.title) : '';
  return {
    id: placementId,
    mapId,
    ...(title ? { title } : {}),
    fallback: formatMapSpecFallback(spec),
    links: mapSpecLinks(spec),
    ...(attributions.length > 1 ? { attributions } : {}),
    attribution,
  };
}

export const createMapPayload = mapSpecToPayload;
