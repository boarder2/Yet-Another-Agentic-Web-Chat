import handleImageSearch from '@/lib/chains/imageSearchAgent';
import { DEFAULT_CONTEXT_WINDOW } from '@/lib/models/presets';
import { getAvailableChatModelProviders } from '@/lib/providers';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';

interface ChatModel {
  provider: string;
  model: string;
  contextWindowSize?: number;
}

interface ImageSearchBody {
  query: string;
  chatHistory: { role: string; content: string }[];
  chatModel?: ChatModel;
  selectedSystemPromptIds?: string[];
  isPrivate?: boolean;
}

export const POST = async (req: Request) => {
  try {
    const body: ImageSearchBody = await req.json();

    const chatHistory = body.chatHistory
      .map((msg: { role: string; content: string }) => {
        if (msg.role === 'user') {
          return new HumanMessage(msg.content);
        } else if (msg.role === 'assistant') {
          return new AIMessage(msg.content);
        }
      })
      .filter((msg) => msg !== undefined) as BaseMessage[];

    const chatModelProviders = await getAvailableChatModelProviders();
    const requestedModel = body.chatModel;
    const modelSelectionPresent =
      requestedModel !== undefined && requestedModel !== null;
    const providerKey = modelSelectionPresent
      ? requestedModel.provider
      : Object.keys(chatModelProviders)[0];
    const chatModelProvider = chatModelProviders[providerKey];
    const modelKey = modelSelectionPresent
      ? requestedModel.model
      : Object.keys(chatModelProvider ?? {})[0];
    const chatModel = chatModelProvider?.[modelKey];

    let llm: BaseChatModel | undefined;
    if (chatModel) {
      llm = chatModel.model;
      (llm as unknown as { contextWindowSize?: number }).contextWindowSize =
        requestedModel?.contextWindowSize || DEFAULT_CONTEXT_WINDOW;
    }

    if (!llm) {
      return Response.json({ error: 'Invalid chat model' }, { status: 400 });
    }

    const images = await handleImageSearch(
      {
        chat_history: chatHistory,
        query: body.query,
        isPrivate: body.isPrivate,
      },
      llm,
    );

    return Response.json({ images }, { status: 200 });
  } catch (err) {
    console.error(`An error occurred while searching images: ${err}`);
    return Response.json(
      { message: 'An error occurred while searching images' },
      { status: 500 },
    );
  }
};
