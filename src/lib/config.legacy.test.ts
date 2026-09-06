import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/credentials', () => ({
  getCredential: vi.fn(),
}));
vi.mock('@/lib/settings/server', () => ({
  getSearxngApiUrl: vi.fn(() => ''),
}));

import { readLegacyCredentialsConfig } from './config';

const dataDir = mkdtempSync(join(tmpdir(), 'yaawc-legacy-config-'));
const configPath = join(dataDir, 'config.toml');

afterEach(() => {
  vi.unstubAllEnvs();
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe('legacy credential config reader', () => {
  it('ignores retired provider fields while retaining active credentials', () => {
    writeFileSync(
      configPath,
      `
[MODELS.OPENAI]
API_KEY = "openai-legacy-key"

[MODELS.GROQ]
API_KEY = "groq-legacy-key"

[MODELS.AIMLAPI]
API_KEY = "aiml-legacy-key"
`,
    );
    vi.stubEnv('CONFIG_PATH', configPath);

    expect(readLegacyCredentialsConfig()).toEqual({
      'model.openai': 'openai-legacy-key',
    });
  });
});
