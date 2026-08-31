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

const encryption = {
  encrypt: vi.fn(() => 'encrypted-value'),
  tryDecrypt: vi.fn(() => null),
  isEncryptionConfigured: vi.fn(() => false),
  EncryptionNotConfiguredError: class extends Error {},
};
const readLegacyCredentialsConfig = vi.fn(() => ({}));

vi.doMock('@/lib/db', () => ({ default: testDb }));
vi.doMock('@/lib/config', () => ({ readLegacyCredentialsConfig }));
vi.doMock('@/lib/encryption', () => encryption);

let credentialsModule: typeof import('./credentials');

beforeAll(async () => {
  migrate(testDb, { migrationsFolder: 'drizzle' });
  credentialsModule = await import('./credentials');
});

afterAll(() => {
  sqlite.close();
  vi.doUnmock('@/lib/db');
  vi.doUnmock('@/lib/config');
  vi.doUnmock('@/lib/encryption');
});

beforeEach(() => {
  testDb.delete(schema.credentials).run();
  vi.clearAllMocks();
  encryption.isEncryptionConfigured.mockReturnValue(false);
  readLegacyCredentialsConfig.mockReturnValue({});
});

const credentialKeys = () =>
  testDb
    .select({ key: schema.credentials.key })
    .from(schema.credentials)
    .all()
    .map(({ key }) => key)
    .sort();

describe('retired credential cleanup', () => {
  it('deletes retired rows without encryption and preserves active rows', () => {
    testDb
      .insert(schema.credentials)
      .values([
        { key: 'model.groq', value: 'opaque-groq-ciphertext' },
        { key: 'model.aimlapi', value: 'opaque-aiml-ciphertext' },
        { key: 'model.openai', value: 'opaque-openai-ciphertext' },
      ])
      .run();

    credentialsModule.purgeRetiredCredentials();

    expect(credentialKeys()).toEqual(['model.openai']);
    expect(encryption.isEncryptionConfigured).not.toHaveBeenCalled();
    expect(encryption.tryDecrypt).not.toHaveBeenCalled();
  });

  it('is idempotent and keeps retired keys out of the active credential contract', () => {
    credentialsModule.purgeRetiredCredentials();
    credentialsModule.purgeRetiredCredentials();

    expect(credentialsModule.CREDENTIAL_KEYS).not.toContain('model.groq');
    expect(credentialsModule.CREDENTIAL_KEYS).not.toContain('model.aimlapi');
    expect(credentialsModule.RETIRED_CREDENTIAL_KEYS).toEqual([
      'model.groq',
      'model.aimlapi',
    ]);
    expect(credentialKeys()).toEqual([]);
  });
});
