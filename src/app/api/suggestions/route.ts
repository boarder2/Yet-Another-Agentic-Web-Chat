import generateSuggestions from '@/lib/chains/suggestionGeneratorAgent';
import { DEFAULT_CONTEXT_WINDOW } from '@/lib/models/presets';
import { getAvailableChatModelProviders } from '@/lib/providers';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, BaseMessage, HumanMessage } from '@langchain/core/messages';

interface ChatModel {
  provider: string;
  model: string;
  contextWindowSize?: number;
}

interface SuggestionsGenerationBody {
  chatHistory: { role: string; content: string }[];
  chatModel?: ChatModel;
  selectedSystemPromptIds?: string[];
}

export const POST = async (req: Request) => {
  try {
    const body: SuggestionsGenerationBody = await req.json();

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

    const suggestions = await generateSuggestions(
      {
        chat_history: chatHistory,
      },
      llm,
    );

    return Response.json({ suggestions }, { status: 200 });
  } catch (err) {
    console.error(`An error occurred while generating suggestions: ${err}`);
    return Response.json(
      { message: 'An error occurred while generating suggestions' },
      { status: 500 },
    );
  }
};
