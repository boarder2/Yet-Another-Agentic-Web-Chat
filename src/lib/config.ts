import toml from '@iarna/toml';

// Dynamic require for Node.js modules to prevent client-side bundling errors
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = typeof window === 'undefined' ? require('fs') : undefined;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = typeof window === 'undefined' ? require('path') : undefined;

const configFileName = 'config.toml';

interface Config {
  GENERAL: {
    SIMILARITY_MEASURE: string;
    KEEP_ALIVE: string;
    BASE_URL?: string;
    HIDDEN_MODELS: string[];
    PRIVATE_SESSION_DURATION_MINUTES?: number;
  };
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
    OLLAMA: {
      API_URL: string;
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
  TOOLS?: {
    CODE_EXECUTION?: {
      ENABLED?: boolean;
      DOCKER_IMAGE?: string;
      DOCKER_HOST?: string;
      TIMEOUT_SECONDS?: number;
      MEMORY_MB?: number;
      MAX_OUTPUT_CHARS?: number;
    };
  };
  SELECTED_MODELS?: {
    SYSTEM_PROVIDER?: string;
    SYSTEM_MODEL?: string;
    EMBEDDING_PROVIDER?: string;
    EMBEDDING_MODEL?: string;
    LINK_SYSTEM_TO_CHAT?: boolean;
  };
}

type RecursivePartial<T> = {
  [P in keyof T]?: RecursivePartial<T[P]>;
};

const loadConfig = () => {
  // Server-side only
  if (typeof window === 'undefined') {
    const config = toml.parse(
      fs!.readFileSync(path!.join(process.cwd(), `${configFileName}`), 'utf-8'),
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

export const getSimilarityMeasure = () =>
  loadConfig().GENERAL.SIMILARITY_MEASURE;

export const getKeepAlive = () => loadConfig().GENERAL.KEEP_ALIVE;

export const getBaseUrl = () => loadConfig().GENERAL.BASE_URL;

export const getHiddenModels = () => loadConfig().GENERAL.HIDDEN_MODELS;

export const getPrivateSessionDurationMinutes = () =>
  loadConfig().GENERAL.PRIVATE_SESSION_DURATION_MINUTES ?? 1440;

export const getOpenaiApiKey = () => loadConfig().MODELS.OPENAI.API_KEY;

export const getGroqApiKey = () => loadConfig().MODELS.GROQ.API_KEY;

export const getOpenrouterApiKey = () => loadConfig().MODELS.OPENROUTER.API_KEY;

export const getAnthropicApiKey = () => loadConfig().MODELS.ANTHROPIC.API_KEY;

export const getGeminiApiKey = () => loadConfig().MODELS.GEMINI.API_KEY;

export const getSearxngApiEndpoint = () =>
  process.env.SEARXNG_API_URL || loadConfig().API_ENDPOINTS.SEARXNG;

export const getOllamaApiEndpoint = () => loadConfig().MODELS.OLLAMA.API_URL;

export const getDeepseekApiKey = () => loadConfig().MODELS.DEEPSEEK.API_KEY;

export const getAimlApiKey = () => loadConfig().MODELS.AIMLAPI.API_KEY;

export const getCustomOpenaiApiKey = () =>
  loadConfig().MODELS.CUSTOM_OPENAI.API_KEY;

export const getCustomOpenaiApiUrl = () =>
  loadConfig().MODELS.CUSTOM_OPENAI.API_URL;

export const getCustomOpenaiModelName = () =>
  loadConfig().MODELS.CUSTOM_OPENAI.MODEL_NAME;

export const getLMStudioApiEndpoint = () =>
  loadConfig().MODELS.LM_STUDIO.API_URL;

export const getSelectedSystemModel = () => {
  const config = loadConfig();
  return {
    provider: config.SELECTED_MODELS?.SYSTEM_PROVIDER || '',
    name: config.SELECTED_MODELS?.SYSTEM_MODEL || '',
  };
};

export const getSelectedEmbeddingModel = () => {
  const config = loadConfig();
  return {
    provider: config.SELECTED_MODELS?.EMBEDDING_PROVIDER || '',
    name: config.SELECTED_MODELS?.EMBEDDING_MODEL || '',
  };
};

export const getLinkSystemToChat = () => {
  const config = loadConfig();
  return config.SELECTED_MODELS?.LINK_SYSTEM_TO_CHAT ?? true;
};

const mergeConfigs = (
  current: Record<string, unknown>,
  update: Record<string, unknown>,
): Record<string, unknown> => {
  if (update === null || update === undefined) {
    return current;
  }

  if (typeof current !== 'object' || current === null) {
    return update;
  }

  // Handle arrays specifically - don't merge them, replace them
  if (Array.isArray(update)) {
    return update;
  }

  const result = { ...current };

  for (const key in update) {
    if (Object.prototype.hasOwnProperty.call(update, key)) {
      const updateValue = update[key];

      // Handle arrays specifically - don't merge them, replace them
      if (Array.isArray(updateValue)) {
        result[key] = updateValue;
      } else if (
        typeof updateValue === 'object' &&
        updateValue !== null &&
        typeof result[key] === 'object' &&
        result[key] !== null &&
        !Array.isArray(result[key])
      ) {
        result[key] = mergeConfigs(
          result[key] as Record<string, unknown>,
          updateValue as Record<string, unknown>,
        );
      } else if (updateValue !== undefined) {
        result[key] = updateValue;
      }
    }
  }

  return result;
};

const ALLOWED_IMAGE_PATTERN = /^node:\d+(-slim|-alpine)?$/;
const ALLOWED_DOCKER_HOST_PATTERN =
  /^(unix:\/\/\/var\/run\/docker\.sock|https?:\/\/[A-Za-z0-9.-]+(?::\d+)?)$/;

export const getCodeExecutionConfig = () => {
  const config = loadConfig();
  const ce = config.TOOLS?.CODE_EXECUTION;
  const dockerImage = ce?.DOCKER_IMAGE ?? 'node:22-slim';
  const dockerHost = ce?.DOCKER_HOST ?? 'unix:///var/run/docker.sock';

  const disabledConfig = {
    enabled: false,
    dockerImage: 'node:22-slim',
    dockerHost: 'unix:///var/run/docker.sock',
    timeoutSeconds: 30,
    memoryMb: 128,
    maxOutputChars: 10000,
  };

  if (!ALLOWED_IMAGE_PATTERN.test(dockerImage)) {
    console.warn(
      `Invalid TOOLS.CODE_EXECUTION.DOCKER_IMAGE "${dockerImage}". Disabling code execution feature.`,
    );
    return {
      ...disabledConfig,
      validationError: `Invalid DOCKER_IMAGE "${dockerImage}". Must match pattern: node:<version>[-slim|-alpine]`,
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
    maxOutputChars: ce?.MAX_OUTPUT_CHARS ?? 10000,
  };
};

export const updateConfig = (config: RecursivePartial<Config>) => {
  // Server-side only
  if (typeof window === 'undefined') {
    const currentConfig = loadConfig();
    const mergedConfig = mergeConfigs(
      currentConfig as unknown as Record<string, unknown>,
      config as unknown as Record<string, unknown>,
    );
    fs!.writeFileSync(
      path!.join(path!.join(process.cwd(), `${configFileName}`)),
      toml.stringify(mergedConfig as unknown as toml.JsonMap),
    );
  }
};
