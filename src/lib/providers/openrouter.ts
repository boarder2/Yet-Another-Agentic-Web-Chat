export const PROVIDER_INFO = {
  key: 'openrouter',
  displayName: 'OpenRouter',
};
import { ChatOpenRouter } from '@langchain/openrouter';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { getOpenrouterApiKey } from '../config';
import { getOpenrouterQuantizations } from '../settings/server';
import { ChatModel } from '.';

let openrouterChatModels: Record<string, string>[] = [];

async function fetchModelList(): Promise<void> {
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

    const data = await response.json();

    openrouterChatModels = data.data.map((model: Record<string, unknown>) => ({
      displayName: model.name,
      key: model.id,
    }));
  } catch (error) {
    console.error('Error fetching models:', error);
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

  await fetchModelList();

  const openrouterApikey = getOpenrouterApiKey();

  if (!openrouterApikey) return {};

  try {
    const chatModels: Record<string, ChatModel> = {};
    const providerPreferences =
      quantizationConfig.quantizations.length > 0
        ? { quantizations: quantizationConfig.quantizations }
        : undefined;

    openrouterChatModels.forEach((model) => {
      chatModels[model.key] = {
        displayName: model.displayName,
        model: new ChatOpenRouter({
          apiKey: openrouterApikey,
          model: model.key,
          maxRetries: 10,
          ...(providerPreferences ? { provider: providerPreferences } : {}),
        }) as unknown as BaseChatModel,
      };
    });

    return chatModels;
  } catch (err) {
    console.error(`Error loading Openrouter models: ${err}`);
    return {};
  }
};
