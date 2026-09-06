import * as providerCatalog from '@/lib/providers';
import {
  getAvailableChatModelProviders,
  getAvailableEmbeddingModelProviders,
} from '@/lib/providers';
import type { ChatModel } from '@/lib/providers';
import { getAvailableImageGenerationModels } from '@/lib/providers/imageGenerationModels';

export const GET = async (req: Request) => {
  try {
    const url = new URL(req.url);
    const includeHidden = url.searchParams.get('include_hidden') === 'true';
    const forceRefresh = url.searchParams.get('refresh') === 'true';

    const providerMetadataPromise = Object.prototype.hasOwnProperty.call(
      providerCatalog,
      'getAvailableProviderMetadata',
    )
      ? providerCatalog.getAvailableProviderMetadata()
      : Promise.resolve(undefined);
    const [
      chatModelProviders,
      embeddingModelProviders,
      imageGenerationModels,
      providerMetadata,
    ] = await Promise.all([
      getAvailableChatModelProviders({ includeHidden, forceRefresh }),
      getAvailableEmbeddingModelProviders({ includeHidden, forceRefresh }),
      getAvailableImageGenerationModels({ forceRefresh }),
      providerMetadataPromise,
    ]);

    // Build serializable copies without mutating the cached model objects
    const chatResult: Record<
      string,
      Record<
        string,
        {
          displayName: string;
          supportedReasoningEfforts?: ChatModel['supportedReasoningEfforts'];
        }
      >
    > = {};
    Object.keys(chatModelProviders).forEach((provider) => {
      chatResult[provider] = Object.fromEntries(
        Object.keys(chatModelProviders[provider]).map((model) => {
          const entry = chatModelProviders[provider][model];
          return [
            model,
            {
              displayName: entry.displayName,
              ...(entry.supportedReasoningEfforts?.length
                ? {
                    supportedReasoningEfforts: [
                      ...entry.supportedReasoningEfforts,
                    ],
                  }
                : {}),
            },
          ];
        }),
      );
    });

    const embeddingResult: Record<
      string,
      Record<string, { displayName: string }>
    > = {};
    Object.keys(embeddingModelProviders).forEach((provider) => {
      embeddingResult[provider] = Object.fromEntries(
        Object.keys(embeddingModelProviders[provider]).map((model) => [
          model,
          {
            displayName: embeddingModelProviders[provider][model].displayName,
          },
        ]),
      );
    });

    return Response.json(
      {
        chatModelProviders: chatResult,
        embeddingModelProviders: embeddingResult,
        imageGenerationModels,
        ...(providerMetadata === undefined ? {} : { providerMetadata }),
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
