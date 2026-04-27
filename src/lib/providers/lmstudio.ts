import { getLMStudioApiEndpoint } from '../config';
import { ChatModel, EmbeddingModel } from '.';

export const PROVIDER_INFO = {
  key: 'lmstudio',
  displayName: 'LM Studio',
};
import { ChatOpenAI } from '@langchain/openai';
import { OpenAIEmbeddings } from '@langchain/openai';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { Embeddings } from '@langchain/core/embeddings';

interface LMStudioModel {
  id: string;
  name?: string;
}

const FETCH_TIMEOUT_MS = 20000;

const ensureV1Endpoint = (endpoint: string): string =>
  endpoint.endsWith('/v1') ? endpoint : `${endpoint}/v1`;

export const loadLMStudioChatModels = async () => {
  const endpoint = getLMStudioApiEndpoint();

  if (!endpoint) return {};

  try {
    const response = await fetch(`${ensureV1Endpoint(endpoint)}/models`, {
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const responseData = await response.json();
    const chatModels: Record<string, ChatModel> = {};

    responseData.data.forEach((model: LMStudioModel) => {
      chatModels[model.id] = {
        displayName: model.name || model.id,
        model: new ChatOpenAI({
          apiKey: 'lm-studio',
          configuration: {
            baseURL: ensureV1Endpoint(endpoint),
          },
          modelName: model.id,
          // temperature: 0.7,
          streaming: true,
          maxRetries: 10,
        }) as unknown as BaseChatModel,
      };
    });

    return chatModels;
  } catch (err) {
    console.error(`Error loading LM Studio models: ${err}`);
    return {};
  }
};

export const loadLMStudioEmbeddingsModels = async () => {
  const endpoint = getLMStudioApiEndpoint();

  if (!endpoint) return {};

  try {
    const response = await fetch(`${ensureV1Endpoint(endpoint)}/models`, {
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const responseData = await response.json();
    const embeddingsModels: Record<string, EmbeddingModel> = {};

    responseData.data.forEach((model: LMStudioModel) => {
      embeddingsModels[model.id] = {
        displayName: model.name || model.id,
        model: new OpenAIEmbeddings({
          apiKey: 'lm-studio',
          configuration: {
            baseURL: ensureV1Endpoint(endpoint),
          },
          modelName: model.id,
        }) as unknown as Embeddings,
      };
    });

    return embeddingsModels;
  } catch (err) {
    console.error(`Error loading LM Studio embeddings model: ${err}`);
    return {};
  }
};
