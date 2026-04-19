import {
  getAvailableChatModelProviders,
  getAvailableEmbeddingModelProviders,
} from '@/lib/providers';

export const GET = async (req: Request) => {
  try {
    const url = new URL(req.url);
    const includeHidden = url.searchParams.get('include_hidden') === 'true';
    const forceRefresh = url.searchParams.get('refresh') === 'true';

    const [chatModelProviders, embeddingModelProviders] = await Promise.all([
      getAvailableChatModelProviders({ includeHidden, forceRefresh }),
      getAvailableEmbeddingModelProviders({ includeHidden, forceRefresh }),
    ]);

    // Build serializable copies without mutating the cached model objects
    const chatResult: Record<
      string,
      Record<string, { displayName: string }>
    > = {};
    Object.keys(chatModelProviders).forEach((provider) => {
      chatResult[provider] = {};
      Object.keys(chatModelProviders[provider]).forEach((model) => {
        chatResult[provider][model] = {
          displayName: chatModelProviders[provider][model].displayName,
        };
      });
    });

    const embeddingResult: Record<
      string,
      Record<string, { displayName: string }>
    > = {};
    Object.keys(embeddingModelProviders).forEach((provider) => {
      embeddingResult[provider] = {};
      Object.keys(embeddingModelProviders[provider]).forEach((model) => {
        embeddingResult[provider][model] = {
          displayName: embeddingModelProviders[provider][model].displayName,
        };
      });
    });

    return Response.json(
      {
        chatModelProviders: chatResult,
        embeddingModelProviders: embeddingResult,
      },
      {
        status: 200,
      },
    );
  } catch (err) {
    console.error('An error occurred while fetching models', err);
    return Response.json(
      {
        message: 'An error has occurred.',
      },
      {
        status: 500,
      },
    );
  }
};
