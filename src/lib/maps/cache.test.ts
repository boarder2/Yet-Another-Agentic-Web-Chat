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

const sqlite = new Database(':memory:');
sqlite.pragma('foreign_keys = ON');
const testDb = drizzle(sqlite, { schema });
const dataDir = mkdtempSync(join(tmpdir(), 'yaawc-map-cache-'));
let maps: typeof import('./cache');

beforeAll(async () => {
  vi.stubEnv('DATA_DIR', dataDir);
  vi.doMock('@/lib/db', () => ({ default: testDb }));
  vi.resetModules();
  migrate(testDb, { migrationsFolder: 'drizzle' });
  maps = await import('./cache');
});

afterAll(() => {
  sqlite.close();
  rmSync(dataDir, { recursive: true, force: true });
  vi.doUnmock('@/lib/db');
  vi.unstubAllEnvs();
});

beforeEach(() => {
  testDb.delete(schema.mapCache).run();
  maps.clearSensitiveMapCache();
});

describe('mapping cache privacy classification', () => {
  it('keeps exact, coordinate, nearby, route, and associated requests memory-only', () => {
    expect(maps.classifyMapCache({ operation: 'search', query: 'Paris' })).toBe(
      'coarse_locality',
    );
    expect(
      maps.classifyMapCache({
        operation: 'geocode',
        query: '1600 Pennsylvania Avenue',
      }),
    ).toBe('memory');
    expect(
      maps.classifyMapCache({
        operation: 'geocode',
        query: 'The Old Rectory, Church Lane, Testville',
      }),
    ).toBe('memory');
    expect(
      maps.classifyMapCache({
        operation: 'geocode',
        query: 'The Old Rectory, Church Lane, Testville',
      }),
    ).toBe('memory');
    expect(
      maps.classifyMapCache({ operation: 'search', query: '40.000,-75.000' }),
    ).toBe('memory');
    expect(
      maps.classifyMapCache({
        operation: 'nearby',
        center: { lat: 40, lon: -75 },
      }),
    ).toBe('memory');
    expect(maps.classifyMapCache({ operation: 'route' })).toBe('memory');
    expect(
      maps.classifyMapCache({ publicRecord: true, userAssociated: true }),
    ).toBe('memory');
  });

  it('allows only explicitly classified coarse localities and public businesses to be durable', () => {
    expect(maps.classifyMapCache({ operation: 'business' })).toBe(
      'public_business',
    );
    expect(maps.classifyMapCache({ operation: 'details' })).toBe(
      'public_business',
    );
    expect(
      maps.classifyMapCache({ kind: 'coarse_locality', query: 'New York' }),
    ).toBe('coarse_locality');
    expect(
      maps.classifyMapCache({
        kind: 'public_business',
        coordinate: { lat: 40, lon: -75 },
      }),
    ).toBe('memory');
    expect(maps.classifyMapCache({ kind: 'memory' })).toBe('memory');
  });

  it('hashes cache keys deterministically without storing raw request material', () => {
    expect(maps.hashMapCacheKey('places', { b: 2, a: 1 })).toBe(
      maps.hashMapCacheKey('places', { a: 1, b: 2 }),
    );
    expect(maps.hashMapCacheKey('places', { a: 1 })).not.toBe(
      maps.hashMapCacheKey('route', { a: 1 }),
    );
    const key = maps.hashMapCacheKey('places', '1600 Pennsylvania Avenue');
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).not.toContain('Pennsylvania');

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => maps.hashMapCacheKey('places', cyclic)).toThrow(
      'Mapping cache key is not serializable',
    );
  });
});

describe('durable mapping cache', () => {
  it('persists public business/locality values for 30 days and enforces kind matching', () => {
    const store = new maps.MapCacheStore();
    const now = 1_000_000;
    const business = {
      name: 'Public Cafe',
      coordinate: { lat: 40, lon: -75 },
      sourceUrl: 'https://example.test/cafe',
      provider: 'openstreetmap',
    };
    const businessKey = maps.hashMapCacheKey('business', business);
    store.set(businessKey, 'public_business', business, now);

    expect(
      store.get<typeof business>(businessKey, 'public_business', now),
    ).toEqual(business);
    expect(store.get(businessKey, 'coarse_locality', now)).toBeNull();
    expect(
      store.get(businessKey, undefined, now + maps.MAP_CACHE_TTL_MS - 1),
    ).toEqual(business);
    expect(
      store.get(businessKey, undefined, now + maps.MAP_CACHE_TTL_MS),
    ).toBeNull();

    const localityKey = maps.hashMapCacheKey('locality', 'Paris');
    store.set(localityKey, 'coarse_locality', { locality: 'Paris' }, now);
    expect(store.get(localityKey, 'coarse_locality', now)).toEqual({
      locality: 'Paris',
    });
  });

  it('rejects precise coordinates, exact address material, associations, and oversized values', () => {
    const store = new maps.MapCacheStore();
    const now = 2_000_000;

    expect(() =>
      store.set('coordinates', 'coarse_locality', { lat: 40, lon: -75 }, now),
    ).toThrow('Precise mapping data cannot enter the durable cache');
    expect(() =>
      store.set(
        'address',
        'coarse_locality',
        { query: '123 Main Street, Testville' },
        now,
      ),
    ).toThrow(/Precise mapping data/);
    expect(() =>
      store.set(
        'associated',
        'public_business',
        { name: 'Cafe', userId: 'user-1' },
        now,
      ),
    ).toThrow(/user associations/);
    expect(() =>
      store.set(
        'large',
        'public_business',
        { value: 'x'.repeat(512_001) },
        now,
      ),
    ).toThrow(/size limit/);
  });

  it('prunes expired rows and clearMapCache also drops process-local sensitive entries', () => {
    const store = new maps.MapCacheStore();
    const now = 3_000_000;
    store.set('one', 'coarse_locality', { locality: 'One' }, now);
    store.set('two', 'coarse_locality', { locality: 'Two' }, now);
    maps.setSensitiveMapCache('secret', { exact: { lat: 40, lon: -75 } });

    expect(store.prune(now + maps.MAP_CACHE_TTL_MS - 1)).toBe(0);
    expect(store.prune(now + maps.MAP_CACHE_TTL_MS)).toBe(2);
    expect(maps.getSensitiveMapCache('secret')).toEqual({
      exact: { lat: 40, lon: -75 },
    });

    store.set('three', 'coarse_locality', { locality: 'Three' }, now);
    expect(store.clear()).toBe(1);
    expect(maps.getSensitiveMapCache('secret')).toBeNull();
    expect(testDb.select().from(schema.mapCache).all()).toHaveLength(0);
  });
});

describe('bounded sensitive map memory cache', () => {
  it('is LRU-bounded and expires entries without extending their TTL on read', () => {
    let now = 0;
    const cache = new maps.BoundedMapMemoryCache(2, 100, () => now);
    cache.set('a', 'A');
    cache.set('b', 'B');
    expect(cache.get('a')).toBe('A');
    cache.set('c', 'C');
    expect(cache.get('b')).toBeNull();
    expect(cache.size).toBe(2);

    now = 99;
    expect(cache.get('a')).toBe('A');
    now = 100;
    expect(cache.get('a')).toBeNull();
    expect(cache.prune()).toBe(1);
    expect(cache.size).toBe(0);
  });
});
