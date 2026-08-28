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
import {
  MAPPING_SETTING_KEYS,
  MappingClientConfigSchema,
} from '@/lib/maps/config';
import { MIGRATED_SETTING_KEYS } from './keys';

const sqlite = new Database(':memory:');
const testDb = drizzle(sqlite, { schema });
const dataDir = mkdtempSync(join(tmpdir(), 'yaawc-mapping-settings-'));
let settings: typeof import('./server');

beforeAll(async () => {
  vi.stubEnv('DATA_DIR', dataDir);
  vi.doMock('@/lib/db', () => ({ default: testDb }));
  vi.resetModules();
  migrate(testDb, { migrationsFolder: 'drizzle' });
  settings = await import('./server');
});

afterAll(() => {
  sqlite.close();
  rmSync(dataDir, { recursive: true, force: true });
  vi.doUnmock('@/lib/db');
  vi.unstubAllEnvs();
});

beforeEach(() => {
  testDb.delete(schema.appSettings).run();
});

function put(values: Record<string, string>): void {
  testDb
    .insert(schema.appSettings)
    .values(
      Object.entries(values).map(([key, value]) => ({
        key,
        value,
        updatedAt: new Date(),
      })),
    )
    .run();
}

describe('server mapping settings resolution', () => {
  it('keeps every mapping setting database-synced through the shared allowlist', () => {
    expect(new Set(MAPPING_SETTING_KEYS).size).toBe(
      MAPPING_SETTING_KEYS.length,
    );
    for (const key of MAPPING_SETTING_KEYS) {
      expect(MIGRATED_SETTING_KEYS).toContain(key);
    }
  });

  it('reads authoritative DB values and preserves disabled-by-default/public acknowledgement gating', () => {
    expect(settings.getMappingConfiguration()).toMatchObject({
      enabled: false,
      available: false,
      unavailableReason: 'disabled',
    });

    put({ mappingEnabled: 'true' });
    expect(settings.getMappingConfiguration()).toMatchObject({
      enabled: true,
      available: false,
      unavailableReason: 'public_acknowledgement_required',
    });

    put({ mappingPublicServicesAcknowledged: 'true' });
    expect(settings.getMappingConfiguration()).toMatchObject({
      enabled: true,
      available: true,
    });
  });

  it('returns a schema-valid client projection without provider endpoints or identity headers', () => {
    put({
      mappingEnabled: 'true',
      mappingPublicServicesAcknowledged: 'true',
      mappingTileUrl: 'https://tiles.example/{z}/{x}/{y}.png',
      mappingTileAttribution: 'Example tiles',
      mappingSavedLocationEnabled: 'true',
    });

    const client = settings.getMappingClientConfiguration();
    expect(MappingClientConfigSchema.safeParse(client).success).toBe(true);
    expect(client).toMatchObject({
      enabled: true,
      available: true,
      tile: {
        url: 'https://tiles.example/{z}/{x}/{y}.png',
        attribution: 'Example tiles',
      },
      savedLocationEnabled: true,
    });
    expect(client).not.toHaveProperty('endpoints');
    expect(client).not.toHaveProperty('userAgent');
  });
});
