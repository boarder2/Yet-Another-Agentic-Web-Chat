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
  getHiddenModels,
  getSelectedSystemModel,
  getSelectedEmbeddingModel,
  getLinkSystemToChat,
  getPrivateSessionDurationMinutes,
  updateConfig,
} from '@/lib/config';
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
    config['hiddenModels'] = getHiddenModels();

    // Selected model preferences
    const selectedSystem = getSelectedSystemModel();
    const selectedEmbedding = getSelectedEmbeddingModel();
    config['selectedSystemModelProvider'] = selectedSystem.provider;
    config['selectedSystemModel'] = selectedSystem.name;
    config['selectedEmbeddingModelProvider'] = selectedEmbedding.provider;
    config['selectedEmbeddingModel'] = selectedEmbedding.name;
    config['linkSystemToChat'] = getLinkSystemToChat();
    config['privateSessionDurationMinutes'] =
      getPrivateSessionDurationMinutes();

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
      if (newValue === 'protected') {
        return currentConfig;
      }
      return newValue;
    };

    const updatedConfig = {
      GENERAL: {
        HIDDEN_MODELS: config.hiddenModels || [],
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

    // Save selected model preferences if provided
    const modelSelections: Partial<
      NonNullable<Parameters<typeof updateConfig>[0]['SELECTED_MODELS']>
    > = {};
    if (config.selectedSystemModelProvider !== undefined) {
      modelSelections.SYSTEM_PROVIDER = config.selectedSystemModelProvider;
    }
    if (config.selectedSystemModel !== undefined) {
      modelSelections.SYSTEM_MODEL = config.selectedSystemModel;
    }
    if (config.selectedEmbeddingModelProvider !== undefined) {
      modelSelections.EMBEDDING_PROVIDER =
        config.selectedEmbeddingModelProvider;
    }
    if (config.selectedEmbeddingModel !== undefined) {
      modelSelections.EMBEDDING_MODEL = config.selectedEmbeddingModel;
    }
    if (config.linkSystemToChat !== undefined) {
      modelSelections.LINK_SYSTEM_TO_CHAT = config.linkSystemToChat;
    }
    if (Object.keys(modelSelections).length > 0) {
      updateConfig({ SELECTED_MODELS: modelSelections });
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
