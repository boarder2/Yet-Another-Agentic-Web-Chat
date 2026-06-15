import {
  getCustomOpenaiApiKey,
  getCustomOpenaiApiUrl,
  getCustomOpenaiModelName,
} from '@/lib/config';
import { DEFAULT_CONTEXT_WINDOW } from '@/lib/models/presets';
import { getAvailableChatModelProviders } from '@/lib/providers';
import { removeThinkingBlocks } from '@/lib/utils/contentUtils';
import { hydrateSearchHits, searchChatsByKeywords } from '@/lib/db/chatSearch';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { PromptTemplate } from '@langchain/core/prompts';
import { RunnableSequence } from '@langchain/core/runnables';
import { ChatOllama } from '@langchain/ollama';
import { ChatOpenAI } from '@langchain/openai';

const searchTermsPrompt = `You are a search assistant. Given a natural language query, extract specific search terms to find relevant conversations in a personal chat history.

Query: {query}

Extract 1-5 specific, distinct search terms or phrases that could appear in conversations matching this query. Each term should be concise (1-4 words).

Output each term on a separate line between <terms> and </terms> XML tags. Do not include any other text.

Example:
Query: Find conversations about Star Wars and space combat
<terms>
Star Wars
space combat
X-Wing
Tie Fighter
</terms>

Now extract terms for the actual query:
<terms>
`;

export const POST = async (req: Request) => {
  try {
    const { query, chatModel, workspaceId, workspaceIds } = await req.json();

    if (!query?.trim()) {
      return Response.json({ message: 'Query is required' }, { status: 400 });
    }

    const chatModelProviders = await getAvailableChatModelProviders();
    const chatModelProvider =
      chatModelProviders[
        chatModel?.provider || Object.keys(chatModelProviders)[0]
      ];
    const selectedChatModel =
      chatModelProvider?.[
        chatModel?.model || Object.keys(chatModelProvider)[0]
      ];

    let llm: BaseChatModel | undefined;

    if (chatModel?.provider === 'custom_openai') {
      llm = new ChatOpenAI({
        apiKey: getCustomOpenaiApiKey(),
        modelName: getCustomOpenaiModelName(),
        configuration: {
          baseURL: getCustomOpenaiApiUrl(),
        },
      }) as unknown as BaseChatModel;
    } else if (chatModelProvider && selectedChatModel) {
      llm = selectedChatModel.model;
      if (llm instanceof ChatOllama && chatModel?.provider === 'ollama') {
        llm.numCtx = chatModel.contextWindowSize || DEFAULT_CONTEXT_WINDOW;
      }
      (llm as unknown as { contextWindowSize?: number }).contextWindowSize =
        chatModel.contextWindowSize || DEFAULT_CONTEXT_WINDOW;
    }

    if (!llm) {
      return Response.json({ error: 'Invalid chat model' }, { status: 400 });
    }

    (llm as unknown as ChatOpenAI).temperature = 0;

    const chain = RunnableSequence.from([
      PromptTemplate.fromTemplate(searchTermsPrompt),
      llm,
      new StringOutputParser(),
    ]);

    const rawOutput = await chain.invoke({ query: query.trim() });
    const cleaned = removeThinkingBlocks(rawOutput);

    const endTagIndex = cleaned.indexOf('</terms>');
    const termsText =
      endTagIndex !== -1 ? cleaned.slice(0, endTagIndex) : cleaned;

    const terms = termsText
      .split('\n')
      .map((line) => line.replace(/^(\s*(-|\*|\d+\.)\s*)+/, '').trim())
      .filter((line) => line.length > 0 && !line.startsWith('<'));

    const searchTerms = terms.length > 0 ? terms : [query.trim()];

    const hits = await searchChatsByKeywords({
      keywords: searchTerms,
      workspaceId,
      workspaceIds,
      includePrivate: true,
      includeCompaction: true,
      limit: 200,
    });

    const { chats: combinedChats, totalMessages } = await hydrateSearchHits(
      hits,
      searchTerms,
    );

    return Response.json(
      {
        chats: combinedChats,
        terms: searchTerms,
        total: combinedChats.length,
        totalMessages,
      },
      { status: 200 },
    );
  } catch (err) {
    console.error('Error in LLM chat search: ', err);
    return Response.json(
      { message: 'An error has occurred.' },
      { status: 500 },
    );
  }
};
