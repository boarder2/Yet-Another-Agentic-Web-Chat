import type {
  MapPlaceDetailsRequest,
  MapPlaceDetailsResult,
  MapPlaceSearchRequest,
  MapPlaceSearchResult,
  MapProviderCapabilities,
  MapRouteRequest,
  MapRouteResult,
} from '../types';

export interface MapProviderRequestOptions {
  signal?: AbortSignal;
}

export interface MapProvider {
  readonly id: string;
  readonly displayName: string;
  readonly attribution: string;
  readonly capabilities: MapProviderCapabilities;

  searchPlaces(
    request: MapPlaceSearchRequest,
    options?: MapProviderRequestOptions,
  ): Promise<MapPlaceSearchResult>;
  getPlaceDetails(
    request: MapPlaceDetailsRequest,
    options?: MapProviderRequestOptions,
  ): Promise<MapPlaceDetailsResult>;
  getRoute(
    request: MapRouteRequest,
    options?: MapProviderRequestOptions,
  ): Promise<MapRouteResult>;
}

export interface MapProviderClientOptions {
  signal?: AbortSignal;
}

export interface OpenStreetMapProviderConfig {
  geocoderUrl: string;
  placesUrl: string;
  routingUrl: string;
  routingProfile?: string;
  routeProfiles?: {
    driving: string;
    walking?: string;
    cycling?: string;
  };
  tileAttribution?: string;
  userAgent?: string;
}
