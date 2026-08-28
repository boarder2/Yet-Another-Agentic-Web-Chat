import {
  MAP_ROUTE_MODES,
  MapAttributionSchema,
  MapPlaceDetailsRequestSchema,
  MapPlaceSearchRequestSchema,
  MapRouteRequestSchema,
  type MapPlaceDetailsRequest,
  type MapPlaceDetailsResult,
  type MapPlaceSearchRequest,
  type MapPlaceSearchResult,
  type MapProviderCapabilities,
  type MapRouteRequest,
  type MapRouteResult,
} from '../types';
import { MapError, MapValidationError } from '../request';
import { normalizeMappingEndpoint } from '../config';
import { NominatimClient } from './nominatim';
import { OverpassClient } from './overpass';
import { OsrmClient } from './osrm';
import type {
  MapProvider,
  MapProviderClientOptions,
  OpenStreetMapProviderConfig,
} from './types';

export const OPENSTREETMAP_PROVIDER_ID = 'openstreetmap';
export const OPENSTREETMAP_PROVIDER_NAME = 'OpenStreetMap-compatible';
export const OPENSTREETMAP_ATTRIBUTION = '© OpenStreetMap contributors';

export interface OpenStreetMapProviderOptions {
  nominatim?: NominatimClient;
  overpass?: OverpassClient;
  osrm?: OsrmClient;
}

function capabilitiesFor(
  config: OpenStreetMapProviderConfig,
): MapProviderCapabilities {
  const profiles = config.routeProfiles ?? {
    driving: config.routingProfile ?? 'driving',
  };
  const routeModes = [
    ...(profiles.driving ? (['driving'] as const) : []),
    ...(profiles.walking ? (['walking'] as const) : []),
    ...(profiles.cycling ? (['cycling'] as const) : []),
  ];
  return {
    geocoding: true,
    nearby: true,
    placeDetails: true,
    routing: routeModes.length > 0,
    routeModes,
    tiles: true,
  };
}

/** Compose the three small OpenStreetMap-compatible HTTP adapters behind one provider. */
export class OpenStreetMapProvider implements MapProvider {
  readonly id = OPENSTREETMAP_PROVIDER_ID;
  readonly displayName = OPENSTREETMAP_PROVIDER_NAME;
  readonly attribution: string;
  readonly capabilities: MapProviderCapabilities;
  readonly nominatim: NominatimClient;
  readonly overpass: OverpassClient;
  readonly osrm: OsrmClient;

  constructor(
    config: OpenStreetMapProviderConfig,
    options: OpenStreetMapProviderOptions = {},
  ) {
    for (const [value, label] of [
      [config.geocoderUrl, 'mapping geocoder URL'],
      [config.placesUrl, 'mapping places URL'],
      [config.routingUrl, 'mapping routing URL'],
    ] as const) {
      const normalized = normalizeMappingEndpoint(value, label);
      if (normalized.error) throw new MapValidationError(normalized.error);
    }

    const attribution =
      config.tileAttribution ??
      options.nominatim?.attribution ??
      options.overpass?.attribution ??
      options.osrm?.attribution ??
      OPENSTREETMAP_ATTRIBUTION;
    const parsedAttribution = MapAttributionSchema.safeParse(attribution);
    if (!parsedAttribution.success)
      throw new MapValidationError('Mapping attribution is invalid');
    this.attribution = parsedAttribution.data;
    this.nominatim =
      options.nominatim ??
      new NominatimClient({
        endpoint: config.geocoderUrl,
        userAgent: config.userAgent,
        attribution: this.attribution,
      });
    this.overpass =
      options.overpass ??
      new OverpassClient({
        endpoint: config.placesUrl,
        userAgent: config.userAgent,
        attribution: this.attribution,
      });
    this.osrm =
      options.osrm ??
      new OsrmClient({
        endpoint: config.routingUrl,
        profile: config.routingProfile,
        profiles: config.routeProfiles,
        userAgent: config.userAgent,
        attribution: this.attribution,
      });
    this.capabilities = capabilitiesFor(config);
  }

  async searchPlaces(
    rawRequest: MapPlaceSearchRequest,
    options: MapProviderClientOptions = {},
  ): Promise<MapPlaceSearchResult> {
    const parsed = MapPlaceSearchRequestSchema.safeParse(rawRequest);
    if (!parsed.success)
      throw new MapValidationError('Invalid mapping place search request');
    const request = parsed.data;
    if (request.center) return this.overpass.searchNearby(request, options);
    return this.nominatim.search(request, options);
  }

  async searchNearby(
    request: MapPlaceSearchRequest,
    options: MapProviderClientOptions = {},
  ): Promise<MapPlaceSearchResult> {
    return this.overpass.searchNearby(request, options);
  }

  async getPlaceDetails(
    rawRequest: MapPlaceDetailsRequest,
    options: MapProviderClientOptions = {},
  ): Promise<MapPlaceDetailsResult> {
    const parsed = MapPlaceDetailsRequestSchema.safeParse(rawRequest);
    if (!parsed.success)
      throw new MapValidationError('Invalid mapping place request');
    return this.nominatim.details(parsed.data, options);
  }

  async getRoute(
    rawRequest: MapRouteRequest,
    options: MapProviderClientOptions = {},
  ): Promise<MapRouteResult> {
    const parsed = MapRouteRequestSchema.safeParse(rawRequest);
    if (!parsed.success)
      throw new MapValidationError('Invalid mapping route request');
    const request = parsed.data;
    if (!MAP_ROUTE_MODES.includes(request.mode)) {
      throw new MapError('unsupported', 'This routing mode is not supported');
    }
    if (!this.capabilities.routeModes.includes(request.mode)) {
      throw new MapError('unsupported', 'This routing mode is not configured');
    }
    return this.osrm.route(request, options);
  }

  search = this.searchPlaces.bind(this);
  details = this.getPlaceDetails.bind(this);
  route = this.getRoute.bind(this);
}

export function createOpenStreetMapProvider(
  config: OpenStreetMapProviderConfig,
  options: OpenStreetMapProviderOptions = {},
): OpenStreetMapProvider {
  return new OpenStreetMapProvider(config, options);
}
