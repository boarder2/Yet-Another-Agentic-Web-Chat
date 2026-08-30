import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const events: string[] = [];
  return {
    events,
    seedSettingsFromConfig: vi.fn(),
    migrateWorkspaceBlobs: vi.fn(),
    backfillSanitizedContent: vi.fn(() => Promise.resolve()),
    purgeRetiredCredentials: vi.fn(() => events.push('purge')),
    isEncryptionConfigured: vi.fn(() => {
      events.push('encryption-check');
      return false;
    }),
    migrateMcpAuth: vi.fn(() => events.push('mcp-migration')),
    migrateLegacyCredentials: vi.fn(() => events.push('credential-migration')),
    migrateScheduledTasks: vi.fn(),
    initScheduler: vi.fn(() => Promise.resolve()),
  };
});

vi.mock('./lib/settings/seed', () => ({
  seedSettingsFromConfig: mocks.seedSettingsFromConfig,
}));
vi.mock('./lib/workspaces/migrateBlobs', () => ({
  migrateWorkspaceBlobs: mocks.migrateWorkspaceBlobs,
}));
vi.mock('./lib/db/backfillSanitizedContent', () => ({
  backfillSanitizedContent: mocks.backfillSanitizedContent,
}));
vi.mock('./lib/credentials', () => ({
  purgeRetiredCredentials: mocks.purgeRetiredCredentials,
  migrateLegacyCredentials: mocks.migrateLegacyCredentials,
}));
vi.mock('./lib/encryption', () => ({
  isEncryptionConfigured: mocks.isEncryptionConfigured,
}));
vi.mock('./lib/mcp/migrateAuth', () => ({
  migrateMcpAuth: mocks.migrateMcpAuth,
}));
vi.mock('./lib/scheduledTasks/migrateScheduledTasks', () => ({
  migrateScheduledTasks: mocks.migrateScheduledTasks,
}));
vi.mock('./lib/scheduledTasks/scheduler', () => ({
  initScheduler: mocks.initScheduler,
}));

import { register } from './instrumentation';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.events.length = 0;
  vi.stubEnv('NEXT_RUNTIME', 'nodejs');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('startup retired credential cleanup', () => {
  it('runs before encryption-dependent migrations when encryption is unavailable', async () => {
    await register();

    expect(mocks.events).toEqual(['purge', 'encryption-check']);
    expect(mocks.purgeRetiredCredentials).toHaveBeenCalledTimes(1);
    expect(mocks.migrateMcpAuth).not.toHaveBeenCalled();
    expect(mocks.migrateLegacyCredentials).not.toHaveBeenCalled();
  });

  it('keeps the purge ahead of both credential migrations when encryption is configured', async () => {
    mocks.isEncryptionConfigured.mockImplementation(() => {
      mocks.events.push('encryption-check');
      return true;
    });

    await register();

    expect(mocks.events).toEqual([
      'purge',
      'encryption-check',
      'mcp-migration',
      'credential-migration',
    ]);
  });
});
