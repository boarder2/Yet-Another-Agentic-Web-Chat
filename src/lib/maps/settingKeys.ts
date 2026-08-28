/**
 * Database-backed mapping settings. This module intentionally has no runtime
 * dependencies so the settings sync allowlist can be shared by browser and
 * server code.
 */
export const MAPPING_SETTING_KEYS = [
  'mappingEnabled',
  'mappingPublicServicesAcknowledged',
  'mappingProvider',
  'mappingGeocoderUrl',
  'mappingPlacesUrl',
  'mappingRoutingUrl',
  'mappingRoutingProfile',
  'mappingWalkingProfile',
  'mappingCyclingProfile',
  'mappingTileUrl',
  'mappingTileAttribution',
  'mappingSavedLocationEnabled',
  // Accepted legacy names keep older operators' localStorage settings usable;
  // the resolver gives the canonical keys precedence when both are present.
  'mappingNominatimUrl',
  'mappingOverpassUrl',
  'mappingOsrmUrl',
  'mappingOsrmProfile',
  'mappingRoutingWalkingProfile',
  'mappingRoutingCyclingProfile',
  'mappingPublicAcknowledged',
  'mappingPublicServiceAcknowledged',
  'mappingSavedLocationProviderOptIn',
] as const;

export type MappingSettingKey = (typeof MAPPING_SETTING_KEYS)[number];
