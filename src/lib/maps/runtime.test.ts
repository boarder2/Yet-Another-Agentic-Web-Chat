import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MappingConfiguration } from './config';

const mocks = vi.hoisted(() => ({
  getMappingConfiguration: vi.fn(),
  createMappingService: vi.fn(),
}));

vi.mock('@/lib/settings/server', () => ({
  getMappingConfiguration: mocks.getMappingConfiguration,
}));

vi.mock('./service', () => ({
  createMappingService: mocks.createMappingService,
}));

import {
  createMappingRunRuntime,
  mappingConfigurationFingerprint,
  resolveFreshMappingService,
} from './runtime';

const config = (overrides: Partial<MappingConfiguration> = {}) =>
  ({
    enabled: true,
    available: true,
    provider: 'test',
    publicServicesAcknowledged: true,
    usesPublicServices: false,
    publicServiceHosts: [],
    endpoints: {
      geocoderUrl: 'https://geocoder.test',
      placesUrl: 'https://places.test',
      routingUrl: 'https://routing.test',
      tileUrl: 'https://tiles.test/{z}/{x}/{y}.png',
    },
    routingProfile: 'driving',
    routeProfiles: { driving: 'driving' },
    tileAttribution: 'Test attribution',
    userAgent: 'test-agent',
    capabilities: {
      geocoding: true,
      nearby: true,
      placeDetails: true,
      routing: true,
      routeModes: ['driving'],
      tiles: true,
    },
    validationErrors: [],
    savedLocationEnabled: false,
    ...overrides,
  }) as MappingConfiguration;

afterEach(() => {
  vi.clearAllMocks();
});

describe('mapping run runtime', () => {
  it('does not resolve mapping settings or construct a provider for excluded runs', () => {
    const runtime = createMappingRunRuntime(false);

    expect(runtime).toEqual({ config: null, service: null });
    expect(mocks.getMappingConfiguration).not.toHaveBeenCalled();
    expect(mocks.createMappingService).not.toHaveBeenCalled();
  });

  it('snapshots the initial configuration and constructs a service only when it is available', () => {
    const current = config();
    const service = { id: 'service' };
    mocks.getMappingConfiguration.mockReturnValue(current);
    mocks.createMappingService.mockReturnValue(service);

    const runtime = createMappingRunRuntime(true);

    expect(runtime.config).toBe(current);
    expect(runtime.service).toBe(service);
    expect(runtime.fingerprint).toBe(mappingConfigurationFingerprint(current));
    expect(mocks.createMappingService).toHaveBeenCalledWith(current);

    mocks.getMappingConfiguration.mockReturnValue({
      ...current,
      available: false,
      unavailableReason: 'public_acknowledgement_required',
    });
    const unavailable = createMappingRunRuntime(true);
    expect(unavailable.config).toMatchObject({ available: false });
    expect(unavailable.service).toBeNull();
    expect(mocks.createMappingService).toHaveBeenCalledTimes(1);
  });

  it('revalidates the current settings and rejects disabled, stale, or malformed provider snapshots', () => {
    const original = config();
    const service = { id: 'fresh-service' };
    mocks.getMappingConfiguration.mockReturnValue(original);
    mocks.createMappingService.mockReturnValue(service);
    const fingerprint = mappingConfigurationFingerprint(original);

    expect(resolveFreshMappingService(true, fingerprint)).toBe(service);
    expect(mocks.createMappingService).toHaveBeenCalledTimes(1);

    mocks.getMappingConfiguration.mockReturnValue({
      ...original,
      endpoints: {
        ...original.endpoints,
        routingUrl: 'https://new-router.test',
      },
    });
    expect(resolveFreshMappingService(true, fingerprint)).toBeNull();
    expect(mocks.createMappingService).toHaveBeenCalledTimes(1);

    mocks.getMappingConfiguration.mockReturnValue({
      ...original,
      available: false,
      unavailableReason: 'disabled',
    });
    expect(resolveFreshMappingService(true, fingerprint)).toBeNull();
    expect(mocks.createMappingService).toHaveBeenCalledTimes(1);

    mocks.getMappingConfiguration.mockImplementation(() => {
      throw new Error('settings unavailable');
    });
    expect(resolveFreshMappingService(true, fingerprint)).toBeNull();
    expect(resolveFreshMappingService(false, fingerprint)).toBeNull();
  });

  it('changes its non-secret fingerprint when provider capabilities or endpoints change', () => {
    const first = config();
    const second = config({
      capabilities: {
        ...first.capabilities,
        routeModes: ['driving', 'walking'],
      },
    });

    expect(mappingConfigurationFingerprint(first)).not.toBe(
      mappingConfigurationFingerprint(second),
    );
  });
});
