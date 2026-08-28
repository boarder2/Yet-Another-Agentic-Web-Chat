import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAP_USER_AGENT,
  MappingClientConfigSchema,
  PUBLIC_MAP_DEFAULTS,
  normalizeMappingAttribution,
  normalizeMappingEndpoint,
  normalizeMappingTileUrl,
  publicMapServiceHosts,
  resolveMappingConfiguration,
  toClientSafeMappingConfig,
} from './config';

const selfHostedSettings = {
  mappingEnabled: 'true',
  mappingProvider: 'openstreetmap',
  mappingGeocoderUrl: 'http://localhost:8080/nominatim',
  mappingPlacesUrl: 'http://127.0.0.1:8081/overpass',
  mappingRoutingUrl: 'http://[::1]:8082/osrm',
  mappingTileUrl: 'http://localhost:8083/tiles/{z}/{x}/{y}.png',
  mappingTileAttribution: 'Self-hosted map tiles',
  mappingWalkingProfile: 'foot',
  mappingCyclingProfile: 'bike',
};

describe('mapping configuration', () => {
  it('keeps public defaults prefilled but disabled on a fresh installation', () => {
    const config = resolveMappingConfiguration();

    expect(config).toMatchObject({
      enabled: false,
      available: false,
      unavailableReason: 'disabled',
      provider: 'openstreetmap',
      endpoints: {
        geocoderUrl: PUBLIC_MAP_DEFAULTS.geocoderUrl,
        placesUrl: PUBLIC_MAP_DEFAULTS.placesUrl,
        routingUrl: PUBLIC_MAP_DEFAULTS.routingUrl,
        tileUrl: PUBLIC_MAP_DEFAULTS.tileUrl,
      },
      usesPublicServices: true,
      publicServicesAcknowledged: false,
    });
    expect(config.publicServiceHosts).toEqual(
      expect.arrayContaining([
        'nominatim.openstreetmap.org',
        'overpass-api.de',
        'router.project-osrm.org',
        'tile.openstreetmap.org',
      ]),
    );
  });

  it('requires acknowledgement before an enabled public configuration is usable', () => {
    const pending = resolveMappingConfiguration({ mappingEnabled: 'true' });
    expect(pending).toMatchObject({
      enabled: true,
      available: false,
      unavailableReason: 'public_acknowledgement_required',
    });

    const acknowledged = resolveMappingConfiguration({
      mappingEnabled: 'true',
      mappingPublicServicesAcknowledged: 'true',
    });
    expect(acknowledged).toMatchObject({
      enabled: true,
      available: true,
      unavailableReason: undefined,
    });
    expect(acknowledged.capabilities.routeModes).toEqual(['driving']);
  });

  it('allows self-hosted endpoints without public acknowledgement, while still requiring enablement', () => {
    const disabled = resolveMappingConfiguration(selfHostedSettings);
    expect(disabled).toMatchObject({
      enabled: true,
      available: true,
      usesPublicServices: false,
      publicServicesAcknowledged: false,
      publicServiceHosts: [],
    });
    expect(disabled.endpoints).toEqual({
      geocoderUrl: 'http://localhost:8080/nominatim',
      placesUrl: 'http://127.0.0.1:8081/overpass',
      routingUrl: 'http://[::1]:8082/osrm',
      tileUrl: 'http://localhost:8083/tiles/{z}/{x}/{y}.png',
    });
    expect(disabled.capabilities.routeModes).toEqual([
      'driving',
      'walking',
      'cycling',
    ]);

    const notEnabled = resolveMappingConfiguration({
      ...selfHostedSettings,
      mappingEnabled: 'false',
    });
    expect(notEnabled.available).toBe(false);
    expect(notEnabled.unavailableReason).toBe('disabled');
  });

  it('keeps the deterministic provider behind its explicit test gate', () => {
    const unavailable = resolveMappingConfiguration(
      { mappingEnabled: 'true', mappingProvider: 'test' },
      { testProviderEnabled: false },
    );
    expect(unavailable).toMatchObject({
      provider: 'test',
      usesPublicServices: false,
      available: false,
      unavailableReason: 'provider_unavailable',
    });

    const available = resolveMappingConfiguration(
      { mappingEnabled: 'true', mappingProvider: 'test' },
      { testProviderEnabled: true },
    );
    expect(available).toMatchObject({
      provider: 'test',
      available: true,
      publicServiceHosts: [],
    });
  });

  it('fails closed for invalid endpoints, tile templates, profiles, and attribution', () => {
    const config = resolveMappingConfiguration({
      mappingEnabled: 'true',
      mappingPublicServicesAcknowledged: 'true',
      mappingGeocoderUrl: 'javascript:alert(1)',
      mappingTileUrl: 'https://tiles.example/{z}/{x}.png',
      mappingRoutingProfile: 'profile with spaces',
      mappingTileAttribution: '<img src=x>',
    });

    expect(config.available).toBe(false);
    expect(config.unavailableReason).toBe('invalid_configuration');
    expect(config.validationErrors.length).toBeGreaterThanOrEqual(4);
    expect(config.validationErrors.join(' ')).not.toContain('javascript:');
    expect(config.endpoints.geocoderUrl).toBe(PUBLIC_MAP_DEFAULTS.geocoderUrl);
  });

  it('normalizes endpoints and validates tile placeholders and attribution', () => {
    expect(normalizeMappingEndpoint(' https://example.test/api/// ')).toEqual({
      value: 'https://example.test/api',
      error: undefined,
    });
    expect(
      normalizeMappingEndpoint('https://example.test/api?token=secret').error,
    ).toBe('mapping endpoint must not contain URL parameters');
    expect(
      normalizeMappingTileUrl('https://tiles.test/{z}/{x}/{y}.png'),
    ).toEqual({
      value: 'https://tiles.test/{z}/{x}/{y}.png',
      error: undefined,
    });
    expect(
      normalizeMappingTileUrl('https://tiles.test/{z}/{x}.png').error,
    ).toContain('placeholders');
    expect(normalizeMappingAttribution('  © self-host  ')).toEqual({
      value: '© self-host',
    });
  });

  it('projects only client-safe tile and host metadata', () => {
    const config = resolveMappingConfiguration(selfHostedSettings, {
      userAgent: 'private operator identity',
    });
    const client = toClientSafeMappingConfig(config);

    expect(MappingClientConfigSchema.safeParse(client).success).toBe(true);
    expect(client).not.toHaveProperty('endpoints');
    expect(client).not.toHaveProperty('userAgent');
    expect(client.serviceHosts).toEqual([
      'localhost:8080',
      '127.0.0.1:8081',
      '[::1]:8082',
      'localhost:8083',
    ]);
    expect(client.tile).toEqual({
      url: selfHostedSettings.mappingTileUrl,
      attribution: 'Self-hosted map tiles',
    });
    expect(JSON.stringify(client)).not.toContain('private operator identity');
    expect(DEFAULT_MAP_USER_AGENT).toContain('YAAWC');
  });

  it('classifies only non-local endpoint hosts as public service hosts', () => {
    expect(
      publicMapServiceHosts({
        endpoints: {
          geocoderUrl: 'http://localhost:1',
          placesUrl: 'http://10.0.0.1:2',
          routingUrl: 'https://provider.example:3/path',
          tileUrl: 'https://provider.example:3/{z}/{x}/{y}.png',
        },
      }),
    ).toEqual(['provider.example:3']);
  });
});
