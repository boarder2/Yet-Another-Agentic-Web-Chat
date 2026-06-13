import {
  getAnthropicApiKey,
  getBaseUrl,
  getCustomOpenaiApiKey,
  getCustomOpenaiApiUrl,
  getCustomOpenaiModelName,
  getGeminiApiKey,
  getGroqApiKey,
  getOllamaApiEndpoint,
  getOpenaiApiKey,
  getOpenrouterApiKey,
  getDeepseekApiKey,
  getAimlApiKey,
  getLMStudioApiEndpoint,
  getPrivateSessionDurationMinutes,
  getSearxngApiEndpoint,
  getBraveSearchApiKey,
  getBraveLLMApiKey,
  getMojeekApiKey,
  updateConfig,
} from '@/lib/config';
import { getResolvedSearchCapabilities } from '@/lib/search/providers';
import { invalidateModelCache } from '@/lib/providers/modelCache';
import {
  getAvailableChatModelProviders,
  getAvailableEmbeddingModelProviders,
} from '@/lib/providers';

export const GET = async (_req: Request) => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const config: Record<string, any> = {};

    const [chatModelProviders, embeddingModelProviders] = await Promise.all([
      getAvailableChatModelProviders(),
      getAvailableEmbeddingModelProviders(),
    ]);

    config['chatModelProviders'] = {};
    config['embeddingModelProviders'] = {};

    for (const provider in chatModelProviders) {
      config['chatModelProviders'][provider] = Object.keys(
        chatModelProviders[provider],
      ).map((model) => {
        return {
          name: model,
          displayName: chatModelProviders[provider][model].displayName,
        };
      });
    }

    for (const provider in embeddingModelProviders) {
      config['embeddingModelProviders'][provider] = Object.keys(
        embeddingModelProviders[provider],
      ).map((model) => {
        return {
          name: model,
          displayName: embeddingModelProviders[provider][model].displayName,
        };
      });
    }

    // Helper function to obfuscate API keys
    const protectApiKey = (key: string | null | undefined) => {
      return key ? 'protected' : key;
    };

    // Obfuscate all API keys in the response
    config['openaiApiKey'] = protectApiKey(getOpenaiApiKey());
    config['groqApiKey'] = protectApiKey(getGroqApiKey());
    config['anthropicApiKey'] = protectApiKey(getAnthropicApiKey());
    config['geminiApiKey'] = protectApiKey(getGeminiApiKey());
    config['deepseekApiKey'] = protectApiKey(getDeepseekApiKey());
    config['openrouterApiKey'] = protectApiKey(getOpenrouterApiKey());
    config['customOpenaiApiKey'] = protectApiKey(getCustomOpenaiApiKey());
    config['aimlApiKey'] = protectApiKey(getAimlApiKey());

    // Non-sensitive values remain unchanged
    config['ollamaApiUrl'] = getOllamaApiEndpoint();
    config['lmStudioApiUrl'] = getLMStudioApiEndpoint();
    config['customOpenaiApiUrl'] = getCustomOpenaiApiUrl();
    config['customOpenaiModelName'] = getCustomOpenaiModelName();
    config['baseUrl'] = getBaseUrl();

    config['privateSessionDurationMinutes'] =
      getPrivateSessionDurationMinutes();

    // Search provider credentials/endpoint (secrets/infra stay in config.toml).
    // Provider/locale preferences are DB-backed (see settings/server.ts).
    config['searxngApiUrl'] = getSearxngApiEndpoint();
    config['braveSearchApiKey'] = protectApiKey(getBraveSearchApiKey());
    config['braveLLMApiKey'] = protectApiKey(getBraveLLMApiKey());
    config['mojeekApiKey'] = protectApiKey(getMojeekApiKey());
    config['searchCapabilitiesRegular'] = getResolvedSearchCapabilities(false);
    config['searchCapabilitiesPrivate'] = getResolvedSearchCapabilities(true);

    return Response.json({ ...config }, { status: 200 });
  } catch (err) {
    console.error('An error occurred while getting config:', err);
    return Response.json(
      { message: 'An error occurred while getting config' },
      { status: 500 },
    );
  }
};

export const POST = async (req: Request) => {
  try {
    const config = await req.json();

    const getUpdatedProtectedValue = (
      newValue: string,
      currentConfig: string,
    ) => {
      // "protected" is the masked placeholder from GET — keep existing.
      if (newValue === 'protected') {
        return currentConfig;
      }

      return newValue;
    };

    const updatedConfig = {
      GENERAL: {
        ...(config.privateSessionDurationMinutes !== undefined && {
          PRIVATE_SESSION_DURATION_MINUTES:
            config.privateSessionDurationMinutes,
        }),
      },
      MODELS: {
        OPENAI: {
          API_KEY: getUpdatedProtectedValue(
            config.openaiApiKey,
            getOpenaiApiKey(),
          ),
        },
        GROQ: {
          API_KEY: getUpdatedProtectedValue(config.groqApiKey, getGroqApiKey()),
        },
        ANTHROPIC: {
          API_KEY: getUpdatedProtectedValue(
            config.anthropicApiKey,
            getAnthropicApiKey(),
          ),
        },
        GEMINI: {
          API_KEY: getUpdatedProtectedValue(
            config.geminiApiKey,
            getGeminiApiKey(),
          ),
        },
        OLLAMA: {
          API_URL: config.ollamaApiUrl,
        },
        DEEPSEEK: {
          API_KEY: getUpdatedProtectedValue(
            config.deepseekApiKey,
            getDeepseekApiKey(),
          ),
        },
        AIMLAPI: {
          API_KEY: getUpdatedProtectedValue(config.aimlApiKey, getAimlApiKey()),
        },
        LM_STUDIO: {
          API_URL: config.lmStudioApiUrl,
        },
        OPENROUTER: {
          API_KEY: getUpdatedProtectedValue(
            config.openrouterApiKey,
            getOpenrouterApiKey(),
          ),
        },
        CUSTOM_OPENAI: {
          API_URL: config.customOpenaiApiUrl,
          API_KEY: getUpdatedProtectedValue(
            config.customOpenaiApiKey,
            getCustomOpenaiApiKey(),
          ),
          MODEL_NAME: config.customOpenaiModelName,
        },
      },
    };

    updateConfig(updatedConfig);

    // If any model-provider credential or URL changed, invalidate the
    // cached model lists so the next /api/models call refetches from source.
    const providerCredentialFields = [
      'openaiApiKey',
      'groqApiKey',
      'anthropicApiKey',
      'geminiApiKey',
      'ollamaApiUrl',
      'deepseekApiKey',
      'aimlApiKey',
      'lmStudioApiUrl',
      'openrouterApiKey',
      'customOpenaiApiKey',
      'customOpenaiApiUrl',
      'customOpenaiModelName',
    ];
    const providerChanged = providerCredentialFields.some(
      (field) => config[field] !== undefined && config[field] !== 'protected',
    );
    if (providerChanged) {
      invalidateModelCache();
    }

    // Save search provider credentials/endpoint if present. Provider/locale
    // preferences are DB-backed (Settings UI → app_settings), not handled here.
    const hasSearchFields =
      config.searxngApiUrl !== undefined ||
      config.braveSearchApiKey !== undefined ||
      config.braveLLMApiKey !== undefined ||
      config.mojeekApiKey !== undefined;

    if (hasSearchFields) {
      const providers: {
        SEARXNG?: { API_URL?: string };
        BRAVE_SEARCH?: { API_KEY?: string };
        BRAVE_LLM?: { API_KEY?: string };
        MOJEEK?: { API_KEY?: string };
      } = {};
      if (config.searxngApiUrl !== undefined) {
        providers.SEARXNG = { API_URL: config.searxngApiUrl };
      }
      if (config.braveSearchApiKey !== undefined) {
        providers.BRAVE_SEARCH = {
          API_KEY: getUpdatedProtectedValue(
            config.braveSearchApiKey,
            getBraveSearchApiKey(),
          ),
        };
      }
      if (config.braveLLMApiKey !== undefined) {
        providers.BRAVE_LLM = {
          API_KEY: getUpdatedProtectedValue(
            config.braveLLMApiKey,
            getBraveLLMApiKey(),
          ),
        };
      }
      if (config.mojeekApiKey !== undefined) {
        providers.MOJEEK = {
          API_KEY: getUpdatedProtectedValue(
            config.mojeekApiKey,
            getMojeekApiKey(),
          ),
        };
      }
      if (Object.keys(providers).length > 0) {
        updateConfig({ SEARCH: { PROVIDERS: providers } });
      }
    }

    return Response.json({ message: 'Config updated' }, { status: 200 });
  } catch (err) {
    console.error('An error occurred while updating config:', err);
    return Response.json(
      { message: 'An error occurred while updating config' },
      { status: 500 },
    );
  }
};
