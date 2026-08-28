import 'server-only';

import { createHash } from 'node:crypto';
import { createMappingService, type MappingService } from './service';
import { getMappingConfiguration } from '@/lib/settings/server';
import type { MappingConfiguration } from './config';

export interface MappingRunRuntime {
  /** The current server-side configuration, when this turn may use maps. */
  config: MappingConfiguration | null;
  /** A provider facade for the current configuration, if available. */
  service: MappingService | null;
  /** Non-sensitive identity of the provider configuration for resume checks. */
  fingerprint?: string;
}

/** Stable, non-secret identity for the endpoints and capabilities of a run. */
export function mappingConfigurationFingerprint(
  config: MappingConfiguration,
): string {
  const serialized = JSON.stringify({
    enabled: config.enabled,
    available: config.available,
    provider: config.provider,
    publicServicesAcknowledged: config.publicServicesAcknowledged,
    endpoints: config.endpoints,
    routingProfile: config.routingProfile,
    routeProfiles: config.routeProfiles,
    tileAttribution: config.tileAttribution,
    capabilities: config.capabilities,
    userAgent: config.userAgent,
    savedLocationEnabled: config.savedLocationEnabled,
  });
  return createHash('sha256').update(serialized).digest('hex');
}

/**
 * Resolve the initial mapping runtime for a turn. Mapping settings are read
 * here only for an eligible top-level turn; excluded execution surfaces never
 * construct a provider facade.
 */
export function createMappingRunRuntime(eligible: boolean): MappingRunRuntime {
  if (!eligible) return { config: null, service: null };

  let config: MappingConfiguration;
  try {
    config = getMappingConfiguration();
  } catch {
    return { config: null, service: null };
  }
  const fingerprint = mappingConfigurationFingerprint(config);
  if (!config.available) return { config, service: null, fingerprint };

  try {
    return { config, service: createMappingService(config), fingerprint };
  } catch {
    // Provider construction is independent from the ordinary chat path. An
    // unavailable adapter simply leaves mapping tools unable to do work.
    return { config, service: null };
  }
}

/**
 * Re-read mapping settings immediately before a provider operation. A paused
 * run therefore cannot keep using a service after an operator disables or
 * invalidates mapping.
 */
export function resolveFreshMappingService(
  mappingAvailable: boolean,
  expectedFingerprint?: string,
): MappingService | null {
  if (!mappingAvailable) return null;
  try {
    const config = getMappingConfiguration();
    if (!config.available) return null;
    if (
      expectedFingerprint !== undefined &&
      mappingConfigurationFingerprint(config) !== expectedFingerprint
    ) {
      return null;
    }
    return createMappingService(config);
  } catch {
    return null;
  }
}
