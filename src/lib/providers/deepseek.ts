import { ChatOpenAI } from '@langchain/openai';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { getDeepseekApiKey } from '../config';
import { ChatModel } from '.';

export const PROVIDER_INFO = {
  key: 'deepseek',
  displayName: 'Deepseek AI',
};

const DEEPSEEK_MODELS_ENDPOINT = 'https://api.deepseek.com/models';

const displayNameMap: Record<string, string> = {
  'deepseek-chat': 'DeepSeek Chat (V3)',
  'deepseek-reasoner': 'DeepSeek Reasoner (R1)',
  'deepseek-v4-flash': 'DeepSeek V4 Flash',
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
};

function generateDisplayName(modelId: string): string {
  if (displayNameMap[modelId]) {
    return displayNameMap[modelId];
  }

  return modelId
    .replace(/[-_]/g, ' ')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

async function fetchDeepSeekModels(apiKey: string): Promise<{ id: string }[]> {
  const response = await fetch(DEEPSEEK_MODELS_ENDPOINT, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    throw new Error(
      `DeepSeek models endpoint returned ${response.status} ${response.statusText}`,
    );
  }

  const data = await response.json();

  if (!data || !Array.isArray(data.data)) {
    throw new Error('Unexpected DeepSeek models response format');
  }

  const models: { id: string }[] = [];

  for (const model of data.data as Record<string, unknown>[]) {
    if (model && model.id) {
      models.push({ id: String(model.id) });
    }
  }

  return models;
}

export const loadDeepseekChatModels = async () => {
  const deepseekApiKey = getDeepseekApiKey();

  if (!deepseekApiKey) return {};

  try {
    const models = await fetchDeepSeekModels(deepseekApiKey);

    models.sort((a, b) => a.id.localeCompare(b.id));

    const chatModels: Record<string, ChatModel> = {};

    models.forEach((model) => {
      chatModels[model.id] = {
        displayName: generateDisplayName(model.id),
        model: new ChatOpenAI({
          apiKey: deepseekApiKey,
          modelName: model.id,
          maxRetries: 10,
          configuration: {
            baseURL: 'https://api.deepseek.com',
          },
        }) as unknown as BaseChatModel,
      };
    });

    return chatModels;
  } catch (err) {
    console.error(`Error loading Deepseek models: ${err}`);
    return {};
  }
};
