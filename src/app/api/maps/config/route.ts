import { NextResponse } from 'next/server';
import {
  PUBLIC_MAP_DEFAULTS,
  type MappingClientConfig,
} from '@/lib/maps/config';
import { getMappingClientConfiguration } from '@/lib/settings/server';

// Mapping providers use Node's fetch/abort and the server-side settings store.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Return only the current client-safe map/tile configuration. */
export async function GET() {
  try {
    return NextResponse.json(getMappingClientConfiguration(), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    const unavailable: MappingClientConfig = {
      enabled: false,
      available: false,
      provider: 'openstreetmap',
      publicServicesAcknowledged: false,
      usesPublicServices: false,
      serviceHosts: [],
      publicServiceHosts: [],
      tile: {
        url: PUBLIC_MAP_DEFAULTS.tileUrl,
        attribution: PUBLIC_MAP_DEFAULTS.tileAttribution,
      },
      routeProfiles: { driving: PUBLIC_MAP_DEFAULTS.routingProfile },
      capabilities: {
        geocoding: false,
        nearby: false,
        placeDetails: false,
        routing: false,
        routeModes: [],
        tiles: false,
      },
      savedLocationEnabled: false,
      unavailableReason: 'provider_unavailable',
    };
    return NextResponse.json(unavailable, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
