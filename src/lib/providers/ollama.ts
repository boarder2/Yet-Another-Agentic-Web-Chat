import { getKeepAlive, getOllamaApiEndpoint } from '../config';
import { ChatModel, EmbeddingModel } from '.';

export const PROVIDER_INFO = {
  key: 'ollama',
  displayName: 'Ollama',
};
import { ChatOllama } from '@langchain/ollama';
import { OllamaEmbeddings } from '@langchain/ollama';

const FETCH_TIMEOUT_MS = 20000;

export const loadOllamaChatModels = async () => {
  const ollamaApiEndpoint = getOllamaApiEndpoint();

  if (!ollamaApiEndpoint) return {};

  try {
    const res = await fetch(`${ollamaApiEndpoint}/api/tags`, {
      headers: {
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const { models } = await res.json();

    const chatModels: Record<string, ChatModel> = {};

    models.forEach((model: Record<string, string>) => {
      chatModels[model.model] = {
        displayName: model.name,
        model: new ChatOllama({
          baseUrl: ollamaApiEndpoint,
          model: model.model,
          maxRetries: 10,
          // temperature: 0.7,
          keepAlive: getKeepAlive(),
        }),
      };
    });

    return chatModels;
  } catch (err) {
    console.error(`Error loading Ollama models: ${err}`);
    return {};
  }
};

export const loadOllamaEmbeddingModels = async () => {
  const ollamaApiEndpoint = getOllamaApiEndpoint();

  if (!ollamaApiEndpoint) return {};

  try {
    const res = await fetch(`${ollamaApiEndpoint}/api/tags`, {
      headers: {
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const { models } = await res.json();

    const embeddingModels: Record<string, EmbeddingModel> = {};

    models.forEach((model: Record<string, string>) => {
      embeddingModels[model.model] = {
        displayName: model.name,
        model: new OllamaEmbeddings({
          baseUrl: ollamaApiEndpoint,
          model: model.model,
        }),
      };
    });

    return embeddingModels;
  } catch (err) {
    console.error(`Error loading Ollama embeddings models: ${err}`);
    return {};
  }
};
