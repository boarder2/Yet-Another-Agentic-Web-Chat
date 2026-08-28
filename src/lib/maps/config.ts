import { z } from 'zod';
import {
  MAP_PROVIDER_IDS,
  MapProviderCapabilitiesSchema,
  type MapProviderCapabilities,
  type MapProviderId,
} from './types';
export { MAPPING_SETTING_KEYS, type MappingSettingKey } from './settingKeys';

export const PUBLIC_MAP_DEFAULTS = {
  provider: 'openstreetmap',
  geocoderUrl: 'https://nominatim.openstreetmap.org',
  placesUrl: 'https://overpass-api.de/api/interpreter',
  routingUrl: 'https://router.project-osrm.org',
  routingProfile: 'driving',
  tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  tileAttribution: '© OpenStreetMap contributors',
} as const;

export const PUBLIC_MAP_ENDPOINTS = {
  geocoder: PUBLIC_MAP_DEFAULTS.geocoderUrl,
  places: PUBLIC_MAP_DEFAULTS.placesUrl,
  routing: PUBLIC_MAP_DEFAULTS.routingUrl,
  tiles: PUBLIC_MAP_DEFAULTS.tileUrl,
} as const;

export const DEFAULT_MAPPING_CONFIG = PUBLIC_MAP_DEFAULTS;

export const DEFAULT_MAP_USER_AGENT =
  'YAAWC/2.0 (self-hosted mapping; https://github.com/boarder2/Yet-Another-Agentic-Web-Chat)';

const PROFILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/;

export interface MappingEndpoints {
  geocoderUrl: string;
  placesUrl: string;
  routingUrl: string;
  tileUrl: string;
}

export interface MappingRouteProfiles {
  driving: string;
  walking?: string;
  cycling?: string;
}

export interface MappingConfiguration {
  enabled: boolean;
  available: boolean;
  provider: MapProviderId;
  publicServicesAcknowledged: boolean;
  usesPublicServices: boolean;
  publicServiceHosts: string[];
  endpoints: MappingEndpoints;
  routingProfile: string;
  routeProfiles: MappingRouteProfiles;
  tileAttribution: string;
  userAgent: string;
  capabilities: MapProviderCapabilities;
  unavailableReason?:
    | 'disabled'
    | 'public_acknowledgement_required'
    | 'invalid_configuration'
    | 'provider_unavailable';
  validationErrors: string[];
  savedLocationEnabled: boolean;
}

export interface MappingClientConfig {
  enabled: boolean;
  available: boolean;
  provider: MapProviderId;
  publicServicesAcknowledged: boolean;
  usesPublicServices: boolean;
  /** Hosts the server may contact for provider or tile requests. */
  serviceHosts: string[];
  /** Non-local hosts, retained for public-service acknowledgement copy. */
  publicServiceHosts: string[];
  tile: { url: string; attribution: string };
  routeProfiles: MappingRouteProfiles;
  capabilities: MapProviderCapabilities;
  savedLocationEnabled: boolean;
  unavailableReason?: MappingConfiguration['unavailableReason'];
}

const MappingHttpEndpointSchema = z
  .string()
  .min(1)
  .max(2_048)
  .refine((value) => normalizeMappingEndpoint(value).error === undefined, {
    message: 'mapping endpoint must be a valid HTTP(S) URL',
  });
const MappingTileUrlSchema = z
  .string()
  .min(1)
  .max(2_048)
  .refine((value) => validateMappingTileUrl(value) === null, {
    message: 'mapping tile URL must contain valid tile placeholders',
  });
const MappingAttributionValueSchema = z
  .string()
  .refine((value) => validateMappingAttribution(value) === null, {
    message: 'mapping attribution is invalid',
  });

export const MappingEndpointsSchema = z.object({
  geocoderUrl: MappingHttpEndpointSchema,
  placesUrl: MappingHttpEndpointSchema,
  routingUrl: MappingHttpEndpointSchema,
  tileUrl: MappingTileUrlSchema,
});

export const MappingRouteProfilesSchema = z.object({
  driving: z.string().regex(PROFILE_PATTERN),
  walking: z.string().regex(PROFILE_PATTERN).optional(),
  cycling: z.string().regex(PROFILE_PATTERN).optional(),
});

const MappingUnavailableReasonSchema = z.enum([
  'disabled',
  'public_acknowledgement_required',
  'invalid_configuration',
  'provider_unavailable',
]);

export const MappingConfigurationSchema = z.object({
  enabled: z.boolean(),
  available: z.boolean(),
  provider: z.enum(MAP_PROVIDER_IDS),
  publicServicesAcknowledged: z.boolean(),
  usesPublicServices: z.boolean(),
  publicServiceHosts: z.array(z.string()).max(32),
  endpoints: MappingEndpointsSchema,
  routingProfile: z.string().regex(PROFILE_PATTERN),
  routeProfiles: MappingRouteProfilesSchema,
  tileAttribution: MappingAttributionValueSchema,
  userAgent: z
    .string()
    .min(1)
    .max(300)
    .refine((value) => !/[\r\n\u0000]/.test(value), {
      message: 'mapping user agent is invalid',
    }),
  capabilities: MapProviderCapabilitiesSchema,
  unavailableReason: MappingUnavailableReasonSchema.optional(),
  validationErrors: z.array(z.string()).max(32),
  savedLocationEnabled: z.boolean(),
});

export const MappingClientConfigSchema = z.object({
  enabled: z.boolean(),
  available: z.boolean(),
  provider: z.enum(MAP_PROVIDER_IDS),
  publicServicesAcknowledged: z.boolean(),
  usesPublicServices: z.boolean(),
  serviceHosts: z.array(z.string()).max(32),
  publicServiceHosts: z.array(z.string()).max(32),
  tile: z.object({
    url: MappingTileUrlSchema,
    attribution: MappingAttributionValueSchema,
  }),
  routeProfiles: MappingRouteProfilesSchema,
  capabilities: MapProviderCapabilitiesSchema,
  savedLocationEnabled: z.boolean(),
  unavailableReason: MappingUnavailableReasonSchema.optional(),
});

export const MapConfigurationSchema = MappingConfigurationSchema;
export const MapClientConfigSchema = MappingClientConfigSchema;

function getSetting(
  settings: Record<string, string>,
  key: string,
  aliases: readonly string[] = [],
): string | undefined {
  for (const candidate of [key, ...aliases]) {
    const value = settings[candidate];
    if (value !== undefined) return value;
  }
  return undefined;
}

function isTrue(value: string | undefined): boolean {
  return value === 'true';
}

function normalizeHttpUrl(
  rawValue: unknown,
  label: string,
  options: { allowSearch?: boolean } = {},
): { value: string; error?: string } {
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (value.length === 0 || value.length > 2_048) {
    return { value, error: `${label} must be between 1 and 2048 characters` };
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    return { value, error: `${label} contains control characters` };
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { value, error: `${label} must use http or https` };
    }
    if (url.username || url.password) {
      return { value, error: `${label} must not contain credentials` };
    }
    if (url.hash)
      return { value, error: `${label} must not contain a URL fragment` };
    if (url.search && !options.allowSearch) {
      return { value, error: `${label} must not contain URL parameters` };
    }
    url.pathname = url.pathname.replace(/\/+$/, '') || '/';
    const normalized = url.toString().replace(/\/$/, '');
    if (normalized.length > 2_048) {
      return { value, error: `${label} must be between 1 and 2048 characters` };
    }
    return { value: normalized, error: undefined };
  } catch {
    return { value, error: `${label} must be a valid URL` };
  }
}

/** Validate and normalize a provider base endpoint without contacting it. */
export function normalizeMappingEndpoint(
  value: unknown,
  label = 'mapping endpoint',
): { value: string; error?: string } {
  return normalizeHttpUrl(value, label);
}

export function validateMappingEndpoint(
  value: unknown,
  label = 'mapping endpoint',
): string | null {
  return normalizeMappingEndpoint(value, label).error ?? null;
}

export function normalizeMappingTileUrl(rawValue: unknown): {
  value: string;
  error?: string;
} {
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (value.length === 0 || value.length > 2_048) {
    return {
      value,
      error: 'mapping tile URL must be between 1 and 2048 characters',
    };
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    return {
      value,
      error: 'mapping tile URL contains control characters',
    };
  }
  if (
    !value.includes('{z}') ||
    !value.includes('{x}') ||
    !value.includes('{y}')
  ) {
    return {
      value,
      error: 'mapping tile URL must contain {z}, {x}, and {y} placeholders',
    };
  }
  const candidate = value
    .replaceAll('{z}', '1')
    .replaceAll('{x}', '1')
    .replaceAll('{y}', '1');
  const normalized = normalizeHttpUrl(candidate, 'mapping tile URL', {
    allowSearch: true,
  });
  return normalized.error
    ? { value, error: normalized.error }
    : { value, error: undefined };
}

export function validateMappingTileUrl(value: unknown): string | null {
  return normalizeMappingTileUrl(value).error ?? null;
}

export function normalizeMappingAttribution(rawValue: unknown): {
  value: string;
  error?: string;
} {
  const value = typeof rawValue === 'string' ? rawValue.trim() : '';
  if (value.length === 0 || value.length > 500) {
    return {
      value,
      error: 'mapping tile attribution must be between 1 and 500 characters',
    };
  }
  if (/[\u0000-\u001f\u007f<>]/.test(value)) {
    return {
      value,
      error: 'mapping tile attribution contains unsupported characters',
    };
  }
  return { value: value.trim() };
}

export function validateMappingAttribution(value: unknown): string | null {
  return normalizeMappingAttribution(value).error ?? null;
}

function normalizeProfile(
  value: string | undefined,
  label: string,
): { value: string | undefined; error?: string } {
  if (value === undefined || value.trim() === '') return { value: undefined };
  const normalized = value.trim();
  if (!PROFILE_PATTERN.test(normalized)) {
    return {
      value: normalized,
      error: `${label} is not a valid routing profile`,
    };
  }
  return { value: normalized };
}

function hostnameForUrl(value: string): string | null {
  try {
    const url = /^https?:\/\//i.test(value)
      ? new URL(value)
      : new URL(`http://${value}`);
    return url.hostname
      .toLowerCase()
      .replace(/^\[|\]$/g, '')
      .replace(/\.$/, '');
  } catch {
    return null;
  }
}

function hostForUrl(value: string): string | null {
  try {
    return new URL(value).host.toLowerCase();
  } catch {
    return null;
  }
}

function isPrivateOrLocalHostname(hostname: string): boolean {
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname === '::1' ||
    (hostname.includes(':') &&
      (hostname.startsWith('fc') ||
        hostname.startsWith('fd') ||
        hostname.startsWith('fe80:')))
  ) {
    return true;
  }
  if (/^0\.0\.0\.0$/.test(hostname)) return true;
  if (/^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(hostname)) return true;
  if (/^10\.(?:\d{1,3}\.){2}\d{1,3}$/.test(hostname)) return true;
  if (/^169\.254\.(?:\d{1,3}\.)\d{1,3}$/.test(hostname)) return true;
  if (/^192\.168\.(?:\d{1,3}\.)\d{1,3}$/.test(hostname)) return true;
  const private172 = hostname.match(/^172\.(\d{1,3})\.(?:\d{1,3}\.)\d{1,3}$/);
  if (
    private172 &&
    Number(private172[1]) >= 16 &&
    Number(private172[1]) <= 31
  ) {
    return true;
  }
  return false;
}

/** Return whether an endpoint is non-local and may require public-service acknowledgement. */
export function isPublicMapEndpoint(value: string): boolean {
  const hostname = hostnameForUrl(value);
  return hostname !== null && !isPrivateOrLocalHostname(hostname);
}

export function mappingServiceHosts(
  config: Pick<MappingConfiguration, 'endpoints'>,
): string[] {
  const urls = [
    config.endpoints.geocoderUrl,
    config.endpoints.placesUrl,
    config.endpoints.routingUrl,
    config.endpoints.tileUrl,
  ];
  return [
    ...new Set(
      urls.map(hostForUrl).filter((host): host is string => host !== null),
    ),
  ];
}

/**
 * Hosts that can receive a precise browser location for this runtime. The
 * deterministic provider performs no HTTP calls, but its configured tile host
 * still receives browser tile requests and must be disclosed.
 */
export function mappingLocationHosts(
  config: Pick<MappingConfiguration, 'provider' | 'endpoints'>,
): string[] {
  if (config.provider !== 'test') return mappingServiceHosts(config);
  const tileHost = hostForUrl(config.endpoints.tileUrl);
  return tileHost ? [tileHost] : [];
}

/** Return the non-local hosts that a mapping configuration may contact. */
export function publicMapServiceHosts(
  config: Pick<MappingConfiguration, 'endpoints'>,
): string[] {
  return mappingServiceHosts(config).filter(isPublicMapEndpoint);
}

export const mapServiceHosts = mappingServiceHosts;

function usesDefaultServiceHost(value: string, defaultValue: string): boolean {
  const valueHost = hostnameForUrl(value);
  const defaultHost = hostnameForUrl(defaultValue);
  return valueHost !== null && valueHost === defaultHost;
}

function makeCapabilities(
  provider: MapProviderId,
  endpoints: MappingEndpoints,
  routeProfiles: MappingRouteProfiles,
): MapProviderCapabilities {
  const routeModes: MapProviderCapabilities['routeModes'] = [
    'driving',
    ...(routeProfiles.walking ? ['walking' as const] : []),
    ...(routeProfiles.cycling ? ['cycling' as const] : []),
  ];
  return {
    geocoding: provider === 'openstreetmap' || provider === 'test',
    nearby: provider === 'openstreetmap' || provider === 'test',
    placeDetails: provider === 'openstreetmap' || provider === 'test',
    routing: routeModes.length > 0 && Boolean(endpoints.routingUrl),
    routeModes,
    tiles: Boolean(endpoints.tileUrl),
  };
}

/**
 * Resolve serialized app settings into an effective mapping configuration.
 * Missing values deliberately use public defaults but remain unavailable until
 * mapping is enabled and public-service use is acknowledged.
 */
export function resolveMappingConfiguration(
  settings: Record<string, string> = {},
  options: { testProviderEnabled?: boolean; userAgent?: string } = {},
): MappingConfiguration {
  const errors: string[] = [];
  const rawProviderSetting = getSetting(settings, 'mappingProvider');
  const rawProvider = rawProviderSetting?.trim();
  const provider: MapProviderId = (
    MAP_PROVIDER_IDS as readonly string[]
  ).includes(rawProvider ?? PUBLIC_MAP_DEFAULTS.provider)
    ? ((rawProvider ?? PUBLIC_MAP_DEFAULTS.provider) as MapProviderId)
    : PUBLIC_MAP_DEFAULTS.provider;
  if (
    rawProvider !== undefined &&
    !(MAP_PROVIDER_IDS as readonly string[]).includes(rawProvider)
  ) {
    errors.push('mapping provider is not supported');
  }

  const endpoint = (
    key: string,
    fallback: string,
    label: string,
    aliases: readonly string[] = [],
  ): string => {
    const raw = getSetting(settings, key, aliases) ?? fallback;
    const result = normalizeHttpUrl(raw, label);
    if (result.error) errors.push(result.error);
    return result.error ? fallback : result.value;
  };

  const endpoints: MappingEndpoints = {
    geocoderUrl: endpoint(
      'mappingGeocoderUrl',
      PUBLIC_MAP_DEFAULTS.geocoderUrl,
      'mapping geocoder URL',
      ['mappingNominatimUrl'],
    ),
    placesUrl: endpoint(
      'mappingPlacesUrl',
      PUBLIC_MAP_DEFAULTS.placesUrl,
      'mapping places URL',
      ['mappingOverpassUrl'],
    ),
    routingUrl: endpoint(
      'mappingRoutingUrl',
      PUBLIC_MAP_DEFAULTS.routingUrl,
      'mapping routing URL',
      ['mappingOsrmUrl'],
    ),
    tileUrl: PUBLIC_MAP_DEFAULTS.tileUrl,
  };

  const rawTileUrl =
    getSetting(settings, 'mappingTileUrl') ?? PUBLIC_MAP_DEFAULTS.tileUrl;
  const tile = normalizeMappingTileUrl(rawTileUrl);
  if (tile.error) errors.push(tile.error);
  endpoints.tileUrl = tile.error ? PUBLIC_MAP_DEFAULTS.tileUrl : tile.value;

  const rawAttribution =
    getSetting(settings, 'mappingTileAttribution') ??
    PUBLIC_MAP_DEFAULTS.tileAttribution;
  const attribution = normalizeMappingAttribution(rawAttribution);
  if (attribution.error) errors.push(attribution.error);
  const tileAttribution = attribution.error
    ? PUBLIC_MAP_DEFAULTS.tileAttribution
    : attribution.value;

  const driving = normalizeProfile(
    getSetting(settings, 'mappingRoutingProfile', ['mappingOsrmProfile']),
    'mapping routing profile',
  );
  if (driving.error) errors.push(driving.error);
  const walking = normalizeProfile(
    getSetting(settings, 'mappingWalkingProfile', [
      'mappingRoutingWalkingProfile',
    ]),
    'mapping walking profile',
  );
  if (walking.error) errors.push(walking.error);
  const cycling = normalizeProfile(
    getSetting(settings, 'mappingCyclingProfile', [
      'mappingRoutingCyclingProfile',
    ]),
    'mapping cycling profile',
  );
  if (cycling.error) errors.push(cycling.error);

  const routeProfiles: MappingRouteProfiles = {
    driving: driving.value ?? PUBLIC_MAP_DEFAULTS.routingProfile,
    ...(walking.value ? { walking: walking.value } : {}),
    ...(cycling.value ? { cycling: cycling.value } : {}),
  };

  const publicServiceHosts =
    provider === 'test' ? [] : publicMapServiceHosts({ endpoints });
  const publicServicesAcknowledged = isTrue(
    getSetting(settings, 'mappingPublicServicesAcknowledged', [
      'mappingPublicAcknowledged',
      'mappingPublicServiceAcknowledged',
    ]),
  );
  const enabled = isTrue(getSetting(settings, 'mappingEnabled'));
  const testProviderEnabled =
    options.testProviderEnabled ??
    (process.env.YAAWC_TEST_MODE === 'true' ||
      process.env.YAAWC_TEST_MAPPING_PROVIDER === 'true');
  // The acknowledgement is for contacting the shipped public services, not
  // for an operator-selected self-hosted endpoint. A mixed configuration still
  // requires acknowledgement while any shipped public default remains active.
  const usesPublicServices =
    provider !== 'test' &&
    (usesDefaultServiceHost(
      endpoints.geocoderUrl,
      PUBLIC_MAP_DEFAULTS.geocoderUrl,
    ) ||
      usesDefaultServiceHost(
        endpoints.placesUrl,
        PUBLIC_MAP_DEFAULTS.placesUrl,
      ) ||
      usesDefaultServiceHost(
        endpoints.routingUrl,
        PUBLIC_MAP_DEFAULTS.routingUrl,
      ) ||
      usesDefaultServiceHost(endpoints.tileUrl, PUBLIC_MAP_DEFAULTS.tileUrl));

  let unavailableReason: MappingConfiguration['unavailableReason'];
  if (!enabled) unavailableReason = 'disabled';
  else if (errors.length > 0) unavailableReason = 'invalid_configuration';
  else if (provider === 'test' && !testProviderEnabled)
    unavailableReason = 'provider_unavailable';
  else if (usesPublicServices && !publicServicesAcknowledged)
    unavailableReason = 'public_acknowledgement_required';

  const capabilities = makeCapabilities(provider, endpoints, routeProfiles);
  const userAgentCandidate =
    options.userAgent ??
    process.env.YAAWC_MAP_USER_AGENT ??
    DEFAULT_MAP_USER_AGENT;
  const normalizedUserAgent =
    typeof userAgentCandidate === 'string' ? userAgentCandidate.trim() : '';
  const validUserAgent =
    normalizedUserAgent.length > 0 &&
    !/[\r\n\0]/.test(normalizedUserAgent) &&
    normalizedUserAgent.length <= 300;
  if (!validUserAgent) {
    errors.push('mapping user agent is invalid');
    unavailableReason = enabled ? 'invalid_configuration' : unavailableReason;
  }
  const userAgent = validUserAgent
    ? normalizedUserAgent
    : DEFAULT_MAP_USER_AGENT;

  return {
    enabled,
    available: unavailableReason === undefined,
    provider,
    publicServicesAcknowledged,
    usesPublicServices,
    publicServiceHosts,
    endpoints,
    routingProfile: routeProfiles.driving,
    routeProfiles,
    tileAttribution,
    userAgent: userAgent || DEFAULT_MAP_USER_AGENT,
    capabilities,
    unavailableReason,
    validationErrors: errors,
    savedLocationEnabled: isTrue(
      getSetting(settings, 'mappingSavedLocationEnabled', [
        'mappingSavedLocationProviderOptIn',
      ]),
    ),
  };
}

/**
 * Fields safe to send to a browser. Provider endpoint URLs and the identifying
 * User-Agent remain server-side; only hostnames and the client tile template
 * cross the API boundary.
 */
export function toClientSafeMappingConfig(
  config: MappingConfiguration,
): MappingClientConfig {
  return {
    enabled: config.enabled,
    available: config.available,
    provider: config.provider,
    publicServicesAcknowledged: config.publicServicesAcknowledged,
    usesPublicServices: config.usesPublicServices,
    serviceHosts: mappingLocationHosts(config),
    publicServiceHosts: [...config.publicServiceHosts],
    tile: {
      url: config.endpoints.tileUrl,
      attribution: config.tileAttribution,
    },
    routeProfiles: { ...config.routeProfiles },
    capabilities: {
      ...config.capabilities,
      routeModes: [...config.capabilities.routeModes],
    },
    savedLocationEnabled: config.savedLocationEnabled,
    ...(config.unavailableReason
      ? { unavailableReason: config.unavailableReason }
      : {}),
  };
}

export function isMappingAvailable(config: MappingConfiguration): boolean {
  return config.enabled && config.available;
}

export const resolveMapConfiguration = resolveMappingConfiguration;
