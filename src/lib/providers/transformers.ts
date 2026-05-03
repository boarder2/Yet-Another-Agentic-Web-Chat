import { HuggingFaceTransformersEmbeddings } from '@langchain/community/embeddings/huggingface_transformers';

export const PROVIDER_INFO = {
  key: 'transformers',
  displayName: 'Hugging Face',
};

export const loadTransformersEmbeddingsModels = async () => {
  try {
    const embeddingModels = {
      'all-MiniLM-L6-v2': {
        displayName: 'All MiniLM L6 v2',
        model: new HuggingFaceTransformersEmbeddings({
          model: 'Xenova/all-MiniLM-L6-v2',
        }),
      },
      'mxbai-embed-large-v1': {
        displayName: 'MXBAI Embed Large v1',
        model: new HuggingFaceTransformersEmbeddings({
          model: 'mixedbread-ai/mxbai-embed-large-v1',
        }),
      },
      'nomic-embed-text-v1.5': {
        displayName: 'Nomic Embed Text v1.5',
        model: new HuggingFaceTransformersEmbeddings({
          model: 'nomic-ai/nomic-embed-text-v1.5',
        }),
      },
    };

    return embeddingModels;
  } catch (err) {
    console.error(`Error loading Transformers embeddings model: ${err}`);
    return {};
  }
};
