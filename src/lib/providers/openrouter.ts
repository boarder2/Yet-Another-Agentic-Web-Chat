export const PROVIDER_INFO = {
  key: 'openrouter',
  displayName: 'OpenRouter',
};
import { ChatOpenRouter } from '@langchain/openrouter';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { getOpenrouterApiKey } from '../config';
import { getOpenrouterQuantizations } from '../settings/server';
import { ChatModel } from '.';
import {
  getReasoningEffortMetadata,
  type OpenRouterReasoningMetadata,
  type OpenRouterReasoningOption,
} from './reasoningEffort';

interface OpenRouterDiscoveredModel {
  displayName: string;
  key: string;
  supportedParameters?: string[];
  reasoning?: OpenRouterReasoningMetadata;
  reasoningOptions?: OpenRouterReasoningOption[];
}

async function fetchModelList(): Promise<OpenRouterDiscoveredModel[]> {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`API request failed with status: ${response.status}`);
    }

    const data = (await response.json()) as {
      data?: Record<string, unknown>[];
    };

    if (!Array.isArray(data.data)) {
      throw new Error('Unexpected OpenRouter models response format');
    }

    return data.data
      .map((model: Record<string, unknown>) => {
        const key = typeof model.id === 'string' ? model.id : '';
        const displayName =
          typeof model.name === 'string' && model.name.length > 0
            ? model.name
            : key;
        const supportedParameters = Array.isArray(model.supported_parameters)
          ? model.supported_parameters.filter(
              (parameter): parameter is string => typeof parameter === 'string',
            )
          : undefined;
        const reasoning =
          model.reasoning && typeof model.reasoning === 'object'
            ? (model.reasoning as OpenRouterReasoningMetadata)
            : undefined;
        const reasoningOptions = Array.isArray(model.reasoning_options)
          ? (model.reasoning_options.filter(
              (option): option is OpenRouterReasoningOption =>
                Boolean(option) && typeof option === 'object',
            ) as OpenRouterReasoningOption[])
          : undefined;

        return {
          displayName,
          key,
          ...(supportedParameters ? { supportedParameters } : {}),
          ...(reasoning ? { reasoning } : {}),
          ...(reasoningOptions ? { reasoningOptions } : {}),
        };
      })
      .filter((model: OpenRouterDiscoveredModel) => model.key.length > 0);
  } catch (error) {
    console.error('Error fetching models:', error);
    return [];
  }
}

export const loadOpenrouterChatModels = async () => {
  const quantizationConfig = getOpenrouterQuantizations();
  if (!quantizationConfig.valid) {
    console.error(
      `Invalid OpenRouter quantization configuration: ${quantizationConfig.error}`,
    );
    return {};
  }

  const discoveredModels = await fetchModelList();

  const openrouterApikey = getOpenrouterApiKey();

  if (!openrouterApikey) return {};

  try {
    const chatModels: Record<string, ChatModel> = {};
    const providerPreferences =
      quantizationConfig.quantizations.length > 0
        ? { quantizations: quantizationConfig.quantizations }
        : undefined;

    discoveredModels.forEach((model) => {
      chatModels[model.key] = {
        displayName: model.displayName,
        model: new ChatOpenRouter({
          apiKey: openrouterApikey,
          model: model.key,
          maxRetries: 10,
          ...(providerPreferences ? { provider: providerPreferences } : {}),
        }) as unknown as BaseChatModel,
        ...(model.supportedParameters
          ? { supportedParameters: model.supportedParameters }
          : {}),
        ...getReasoningEffortMetadata('openrouter', model.key, {
          supportedParameters: model.supportedParameters,
          reasoning: model.reasoning,
          reasoningOptions: model.reasoningOptions,
        }),
      };
    });

    return chatModels;
  } catch (err) {
    console.error(`Error loading Openrouter models: ${err}`);
    return {};
  }
};
