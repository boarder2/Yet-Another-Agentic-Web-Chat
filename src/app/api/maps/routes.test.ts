import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import * as schema from '@/lib/db/schema';
import { qk } from '@/lib/api/keys';

const sqlite = new Database(':memory:');
const testDb = drizzle(sqlite, { schema });
const dataDir = mkdtempSync(join(tmpdir(), 'yaawc-mapping-routes-'));
let configRoute: typeof import('./config/route');
let cacheRoute: typeof import('./cache/route');
let maps: typeof import('@/lib/maps/cache');

beforeAll(async () => {
  vi.stubEnv('DATA_DIR', dataDir);
  vi.doMock('@/lib/db', () => ({ default: testDb }));
  vi.resetModules();
  migrate(testDb, { migrationsFolder: 'drizzle' });
  [configRoute, cacheRoute, maps] = await Promise.all([
    import('./config/route'),
    import('./cache/route'),
    import('@/lib/maps/cache'),
  ]);
});

afterAll(() => {
  sqlite.close();
  rmSync(dataDir, { recursive: true, force: true });
  vi.doUnmock('@/lib/db');
  vi.unstubAllEnvs();
});

beforeEach(() => {
  testDb.delete(schema.appSettings).run();
  testDb.delete(schema.mapCache).run();
  maps.clearSensitiveMapCache();
});

function put(values: Record<string, string>): void {
  testDb
    .insert(schema.appSettings)
    .values(Object.entries(values).map(([key, value]) => ({ key, value })))
    .run();
}

describe('mapping API boundaries', () => {
  it('returns a safe disabled configuration with no server endpoint or user-agent fields', async () => {
    const response = await configRoute.GET();
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      enabled: false,
      available: false,
      unavailableReason: 'disabled',
      provider: 'openstreetmap',
      tile: {
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '© OpenStreetMap contributors',
      },
    });
    expect(body).not.toHaveProperty('endpoints');
    expect(body).not.toHaveProperty('userAgent');
    expect(JSON.stringify(body)).not.toContain('nominatimUrl');
  });

  it('exposes only host metadata and client-safe tile settings for enabled self-hosted mapping', async () => {
    put({
      mappingEnabled: 'true',
      mappingGeocoderUrl: 'http://localhost:8080/nominatim',
      mappingPlacesUrl: 'http://localhost:8081/overpass',
      mappingRoutingUrl: 'http://localhost:8082/osrm',
      mappingTileUrl: 'http://localhost:8083/tiles/{z}/{x}/{y}.png',
      mappingTileAttribution: 'Self-hosted tiles',
    });

    const response = await configRoute.GET();
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      enabled: true,
      available: true,
      publicServicesAcknowledged: false,
      tile: {
        url: 'http://localhost:8083/tiles/{z}/{x}/{y}.png',
        attribution: 'Self-hosted tiles',
      },
    });
    expect(body.serviceHosts).toEqual([
      'localhost:8080',
      'localhost:8081',
      'localhost:8082',
      'localhost:8083',
    ]);
    expect(body.publicServiceHosts).toEqual([]);
    expect(body).not.toHaveProperty('geocoderUrl');
    expect(body).not.toHaveProperty('placesUrl');
    expect(body).not.toHaveProperty('routingUrl');
  });

  it('clears durable and process-local cache through the cache route', async () => {
    const now = new Date();
    testDb
      .insert(schema.mapCache)
      .values({
        key: 'a'.repeat(64),
        kind: 'coarse_locality',
        value: { locality: 'Paris' },
        createdAt: now,
        expiresAt: new Date(now.getTime() + 60_000),
      })
      .run();
    maps.setSensitiveMapCache('secret', { coordinate: { lat: 40, lon: -75 } });

    const response = await cacheRoute.DELETE();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: 1 });
    expect(testDb.select().from(schema.mapCache).all()).toHaveLength(0);
    expect(maps.getSensitiveMapCache('secret')).toBeNull();
  });

  it('keeps mapping query keys namespaced for cache invalidation', () => {
    expect(qk.mappingConfig).toEqual(['maps', 'config']);
    expect(qk.mappingCache).toEqual(['maps', 'cache']);
  });
});
