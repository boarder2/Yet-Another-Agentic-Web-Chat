import toml from '@iarna/toml';
import { getCredential } from '@/lib/credentials';
import {
  getLMStudioApiUrl,
  getSearxngApiUrl,
  getCustomOpenaiUrlAndModel,
} from '@/lib/settings/server';

// Dynamic require for Node.js modules to prevent client-side bundling errors
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = typeof window === 'undefined' ? require('fs') : undefined;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = typeof window === 'undefined' ? require('path') : undefined;

const configFileName = 'config.toml';

interface Config {
  GENERAL: {
    BASE_URL?: string;
    HIDDEN_MODELS: string[];
    PRIVATE_SESSION_DURATION_MINUTES?: number;
    RETENTION?: {
      CHATS_MODE?: 'days' | 'count' | 'disabled';
      CHATS_VALUE?: number;
      SCHEDULED_RUNS_MODE?: 'days' | 'count' | 'disabled';
      SCHEDULED_RUNS_VALUE?: number;
    };
  };
  // The passphrase src/lib/encryption.ts derives the credential-encryption key
  // from. Must live outside the DB it encrypts, so this is the one credential
  // that stays in config.toml. Required — never auto-generated: if unset,
  // credential encryption is unavailable and the app blocks usage until the
  // user sets it themselves.
  SECURITY?: {
    ENCRYPTION_PASSPHRASE?: string;
  };
  /**
   * Legacy provider/search credential + endpoint fields. No longer read at
   * runtime — API keys are encrypted DB rows (src/lib/credentials.ts) and
   * endpoint URLs are DB-backed settings (src/lib/settings/server.ts). Kept
   * typed here only so the one-time boot migrations
   * (`migrateLegacyCredentials()`, `readLegacyMigratableConfig()`) can still
   * pick up values from existing installs' config.toml.
   */
  MODELS: {
    OPENAI: {
      API_KEY: string;
    };
    GROQ: {
      API_KEY: string;
    };
    ANTHROPIC: {
      API_KEY: string;
    };
    GEMINI: {
      API_KEY: string;
    };
    DEEPSEEK: {
      API_KEY: string;
    };
    AIMLAPI: {
      API_KEY: string;
    };
    LM_STUDIO: {
      API_URL: string;
    };
    OPENROUTER: {
      API_KEY: string;
    };
    CUSTOM_OPENAI: {
      API_URL: string;
      API_KEY: string;
      MODEL_NAME: string;
    };
  };
  API_ENDPOINTS: {
    SEARXNG: string;
  };
  SEARCH?: {
    PROVIDER?: string;
    PRIVATE_PROVIDER?: string;
    FALLBACK_PROVIDER?: string;
    LANGUAGE?: string;
    REGION?: string;
    PROVIDERS?: {
      SEARXNG?: { API_URL?: string };
      BRAVE_SEARCH?: { API_KEY?: string };
      BRAVE_LLM?: { API_KEY?: string };
      MOJEEK?: { API_KEY?: string };
    };
  };
  TOOLS?: {
    CODE_EXECUTION?: {
      ENABLED?: boolean;
      DOCKER_IMAGE?: string;
      DOCKER_HOST?: string;
      TIMEOUT_SECONDS?: number;
      MEMORY_MB?: number;
      MAX_OUTPUT_CHARS?: number;
    };
    IMAGE_GENERATION?: {
      ENABLED?: boolean;
      PROVIDER?: string;
      MODEL?: string;
      ASPECT_RATIO?: string;
      IMAGE_SIZE?: string;
    };
  };
}

const loadConfig = () => {
  // Server-side only
  if (typeof window === 'undefined') {
    const configPath =
      process.env.CONFIG_PATH || path!.join(process.cwd(), configFileName);
    const config = toml.parse(
      fs!.readFileSync(configPath, 'utf-8'),
    ) as unknown as Config;

    // Ensure GENERAL section exists
    if (!config.GENERAL) {
      config.GENERAL = {} as Config['GENERAL'];
    }

    // Handle HIDDEN_MODELS - fix malformed table format to proper array
    if (!config.GENERAL.HIDDEN_MODELS) {
      config.GENERAL.HIDDEN_MODELS = [];
    } else if (
      typeof config.GENERAL.HIDDEN_MODELS === 'object' &&
      !Array.isArray(config.GENERAL.HIDDEN_MODELS)
    ) {
      // Convert malformed table format to array
      const hiddenModelsObj = config.GENERAL.HIDDEN_MODELS as unknown as Record<
        string,
        unknown
      >;
      const hiddenModelsArray: string[] = [];

      // Extract values from numeric keys and sort by key
      const keys = Object.keys(hiddenModelsObj)
        .map((k) => parseInt(k))
        .filter((k) => !isNaN(k))
        .sort((a, b) => a - b);
      for (const key of keys) {
        if (typeof hiddenModelsObj[key] === 'string') {
          hiddenModelsArray.push(hiddenModelsObj[key]);
        }
      }

      config.GENERAL.HIDDEN_MODELS = hiddenModelsArray;
    }

    return config;
  }

  // Client-side fallback - settings will be loaded via API
  return {} as Config;
};

export const getBaseUrl = () =>
  process.env.BASE_URL || loadConfig().GENERAL.BASE_URL;

export const getEncryptionPassphrase = () => {
  // An explicitly-set env var wins over config.toml — including an empty string,
  // which the encryption-gate e2e server uses to force the "not configured"
  // state regardless of the developer's local config.toml passphrase.
  const fromEnv = process.env.ENCRYPTION_PASSPHRASE;
  if (fromEnv !== undefined) return fromEnv || undefined;
  return loadConfig().SECURITY?.ENCRYPTION_PASSPHRASE || undefined;
};

export type RetentionPolicy = {
  mode: 'days' | 'count' | 'disabled';
  value: number;
};

export const getOpenaiApiKey = () => getCredential('model.openai');

export const getGroqApiKey = () => getCredential('model.groq');

export const getOpenrouterApiKey = () => getCredential('model.openrouter');

export const getAnthropicApiKey = () => getCredential('model.anthropic');

export const getGeminiApiKey = () => getCredential('model.gemini');

export const getSearxngApiEndpoint = () =>
  process.env.SEARXNG_API_URL || getSearxngApiUrl();

export type SearchProviderIdType =
  'searxng' | 'brave_search' | 'brave_llm' | 'mojeek';

export const getBraveSearchApiKey = () => getCredential('search.braveSearch');

export const getBraveLLMApiKey = () => getCredential('search.braveLLM');

export const getMojeekApiKey = () => getCredential('search.mojeek');

export const getDeepseekApiKey = () => getCredential('model.deepseek');

export const getAimlApiKey = () => getCredential('model.aimlapi');

export const getCustomOpenaiApiKey = () => getCredential('model.customOpenai');

export const getCustomOpenaiApiUrl = () => getCustomOpenaiUrlAndModel().url;

export const getCustomOpenaiModelName = () =>
  getCustomOpenaiUrlAndModel().modelName;

export const getLMStudioApiEndpoint = () => getLMStudioApiUrl();

// Any tag or digest of the official `node` image: the sandbox only ever runs
// `node -e`, so the repository is the security boundary, not the variant.
const ALLOWED_IMAGE_PATTERN =
  /^node(:[A-Za-z0-9_][A-Za-z0-9._-]{0,127})?(@sha256:[a-f0-9]{64})?$/;
const ALLOWED_DOCKER_HOST_PATTERN =
  /^(unix:\/\/\/var\/run\/docker\.sock|https?:\/\/[A-Za-z0-9.-]+(?::\d+)?)$/;

export const getCodeExecutionConfig = () => {
  const config = loadConfig();
  const ce = config.TOOLS?.CODE_EXECUTION;
  const dockerImage = ce?.DOCKER_IMAGE ?? 'node:24-alpine';
  const dockerHost = ce?.DOCKER_HOST ?? 'unix:///var/run/docker.sock';

  const disabledConfig = {
    enabled: false,
    dockerImage: 'node:24-alpine',
    dockerHost: 'unix:///var/run/docker.sock',
    timeoutSeconds: 30,
    memoryMb: 128,
    maxOutputChars: 50000,
  };

  if (!ALLOWED_IMAGE_PATTERN.test(dockerImage)) {
    console.warn(
      `Invalid TOOLS.CODE_EXECUTION.DOCKER_IMAGE "${dockerImage}". Disabling code execution feature.`,
    );
    return {
      ...disabledConfig,
      validationError: `Invalid DOCKER_IMAGE "${dockerImage}". Must be the official node image: node[:<tag>][@sha256:<digest>]`,
    };
  }

  if (!ALLOWED_DOCKER_HOST_PATTERN.test(dockerHost)) {
    console.warn(
      `Invalid TOOLS.CODE_EXECUTION.DOCKER_HOST "${dockerHost}". Disabling code execution feature.`,
    );
    return {
      ...disabledConfig,
      validationError: `Invalid DOCKER_HOST "${dockerHost}". Must be unix:///var/run/docker.sock or an explicit http(s) proxy URL.`,
    };
  }

  return {
    enabled: ce?.ENABLED ?? false,
    dockerImage,
    dockerHost,
    timeoutSeconds: ce?.TIMEOUT_SECONDS ?? 30,
    memoryMb: ce?.MEMORY_MB ?? 128,
    maxOutputChars: ce?.MAX_OUTPUT_CHARS ?? 50000,
  };
};

export interface ImageGenerationConfig {
  enabled: boolean;
  provider: string;
  model: string;
  aspectRatio: string;
  imageSize: string;
}

/**
 * Legacy config.toml sections that have since been migrated to the DB-backed
 * `app_settings` table. Read raw here ONLY by the one-time seed
 * (`src/lib/settings/seed.ts`) so existing installs don't lose values that were
 * configured before the migration. Runtime reads go through
 * `src/lib/settings/server.ts`, not these.
 */
interface LegacyMigratableConfig {
  SELECTED_MODELS?: {
    SYSTEM_PROVIDER?: string;
    SYSTEM_MODEL?: string;
    EMBEDDING_PROVIDER?: string;
    EMBEDDING_MODEL?: string;
  };
}

/**
 * Returns only the legacy values actually present in config.toml, keyed by their
 * new `app_settings` key. Absent values are omitted so the seed never overwrites
 * a DB value with a config default. Server-only (returns `{}` on the client).
 */
export const readLegacyMigratableConfig = (): Record<string, string> => {
  const cfg = loadConfig();
  const legacy = cfg as Config & LegacyMigratableConfig;
  const out: Record<string, string> = {};
  const put = (key: string, val: string | number | undefined | null) => {
    if (val === undefined || val === null) return;
    out[key] = String(val);
  };

  // [SELECTED_MODELS] → embedding model + memory-processing model
  const sm = legacy.SELECTED_MODELS;
  put('embeddingModelProvider', sm?.EMBEDDING_PROVIDER);
  put('embeddingModel', sm?.EMBEDDING_MODEL);
  put('memoryModelProvider', sm?.SYSTEM_PROVIDER);
  put('memoryModel', sm?.SYSTEM_MODEL);

  // [GENERAL.RETENTION]
  const r = cfg.GENERAL?.RETENTION;
  put('retentionChatsMode', r?.CHATS_MODE);
  put('retentionChatsValue', r?.CHATS_VALUE);
  put('retentionScheduledRunsMode', r?.SCHEDULED_RUNS_MODE);
  put('retentionScheduledRunsValue', r?.SCHEDULED_RUNS_VALUE);

  // GENERAL.PRIVATE_SESSION_DURATION_MINUTES
  put(
    'privateSessionDurationMinutes',
    cfg.GENERAL?.PRIVATE_SESSION_DURATION_MINUTES,
  );

  // [SEARCH] provider + locale preferences (API keys stay in credentials.ts)
  const s = cfg.SEARCH;
  put('searchProvider', s?.PROVIDER);
  put('searchPrivateProvider', s?.PRIVATE_PROVIDER);
  put('searchFallbackProvider', s?.FALLBACK_PROVIDER);
  put('searchLanguage', s?.LANGUAGE);
  put('searchRegion', s?.REGION);

  // GENERAL.HIDDEN_MODELS (loadConfig normalizes to an array) — seed only when
  // the user actually hid something.
  const hidden = cfg.GENERAL?.HIDDEN_MODELS;
  if (Array.isArray(hidden) && hidden.length > 0) {
    out['hiddenModels'] = JSON.stringify(hidden);
  }

  // [TOOLS.IMAGE_GENERATION]
  const ig = cfg.TOOLS?.IMAGE_GENERATION;
  if (ig?.ENABLED !== undefined) {
    out['imageGenerationEnabled'] = ig.ENABLED ? 'true' : 'false';
  }
  put('imageGenerationProvider', ig?.PROVIDER);
  put('imageGenerationModel', ig?.MODEL);
  put('imageGenerationAspectRatio', ig?.ASPECT_RATIO);
  put('imageGenerationImageSize', ig?.IMAGE_SIZE);

  // Provider/search endpoint URLs — non-secret, DB-backed via the same
  // migrated-settings path as the fields above.
  put('lmStudioApiUrl', cfg.MODELS?.LM_STUDIO?.API_URL);
  put('customOpenaiApiUrl', cfg.MODELS?.CUSTOM_OPENAI?.API_URL);
  put('customOpenaiModelName', cfg.MODELS?.CUSTOM_OPENAI?.MODEL_NAME);
  put(
    'searxngApiUrl',
    cfg.SEARCH?.PROVIDERS?.SEARXNG?.API_URL || cfg.API_ENDPOINTS?.SEARXNG,
  );

  return out;
};

/**
 * Legacy provider/search API key values still present in config.toml, keyed by
 * their `credentials` table key (see `CREDENTIAL_KEYS` in
 * `src/lib/credentials.ts`). Read raw here ONLY by the one-time boot migration
 * (`migrateLegacyCredentials()`) so existing installs don't lose keys configured
 * before encryption-at-rest. Runtime reads go through `credentials.ts`, not this.
 */
export const readLegacyCredentialsConfig = (): Record<string, string> => {
  const cfg = loadConfig();
  const out: Record<string, string> = {};
  const put = (key: string, val: string | undefined | null) => {
    if (val === undefined || val === null || val === '') return;
    out[key] = val;
  };

  put('model.openai', cfg.MODELS?.OPENAI?.API_KEY);
  put('model.groq', cfg.MODELS?.GROQ?.API_KEY);
  put('model.anthropic', cfg.MODELS?.ANTHROPIC?.API_KEY);
  put('model.gemini', cfg.MODELS?.GEMINI?.API_KEY);
  put('model.deepseek', cfg.MODELS?.DEEPSEEK?.API_KEY);
  put('model.aimlapi', cfg.MODELS?.AIMLAPI?.API_KEY);
  put('model.openrouter', cfg.MODELS?.OPENROUTER?.API_KEY);
  put('model.customOpenai', cfg.MODELS?.CUSTOM_OPENAI?.API_KEY);
  put('search.braveSearch', cfg.SEARCH?.PROVIDERS?.BRAVE_SEARCH?.API_KEY);
  put('search.braveLLM', cfg.SEARCH?.PROVIDERS?.BRAVE_LLM?.API_KEY);
  put('search.mojeek', cfg.SEARCH?.PROVIDERS?.MOJEEK?.API_KEY);

  return out;
};
