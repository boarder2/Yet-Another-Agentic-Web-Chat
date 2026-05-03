import db from '@/lib/db';
import { chats, messages } from '@/lib/db/schema';
import {
  getCustomOpenaiApiKey,
  getCustomOpenaiApiUrl,
  getCustomOpenaiModelName,
} from '@/lib/config';
import { getAvailableChatModelProviders } from '@/lib/providers';
import { removeThinkingBlocks } from '@/lib/utils/contentUtils';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { PromptTemplate } from '@langchain/core/prompts';
import { RunnableSequence } from '@langchain/core/runnables';
import { ChatOllama } from '@langchain/ollama';
import { ChatOpenAI } from '@langchain/openai';
import { desc, inArray, like, or, sql, isNull, eq, and } from 'drizzle-orm';

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

interface ChatModel {
  provider: string;
  model: string;
  ollamaContextWindow?: number;
}

interface _LlmSearchBody {
  query: string;
  chatModel?: ChatModel;
}

interface ChatRow {
  id: string;
  title: string;
  createdAt: number;
  focusMode: string;
  files: unknown;
  matchExcerpt: string | null;
  messageCount?: number;
}

function extractExcerpt(
  content: string,
  term: string,
  contextLen = 80,
): string {
  const lowerContent = content.toLowerCase();
  const lowerTerm = term.toLowerCase();
  const idx = lowerContent.indexOf(lowerTerm);

  if (idx === -1) {
    const max = contextLen * 2;
    return content.length > max
      ? content.slice(0, max).trim() + '…'
      : content.trim();
  }

  const start = Math.max(0, idx - contextLen);
  const end = Math.min(content.length, idx + term.length + contextLen);

  let excerpt = content.slice(start, end).trim();
  if (start > 0) excerpt = '…' + excerpt;
  if (end < content.length) excerpt = excerpt + '…';

  return excerpt;
}

function buildWorkspaceCondition(
  workspaceId: string | undefined,
  workspaceIds: string[] | undefined,
) {
  if (workspaceIds && workspaceIds.length > 0) {
    const realIds = workspaceIds.filter((id) => id !== 'none');
    const includeNone = workspaceIds.includes('none');
    if (realIds.length > 0 && includeNone) {
      return or(inArray(chats.workspaceId, realIds), isNull(chats.workspaceId));
    }
    if (realIds.length > 0) return inArray(chats.workspaceId, realIds);
    if (includeNone) return isNull(chats.workspaceId);
  }
  if (workspaceId === 'none' || workspaceId === 'null') {
    return isNull(chats.workspaceId);
  }
  if (workspaceId) return eq(chats.workspaceId, workspaceId);
  return undefined;
}

const searchByTerm = async (
  term: string,
  workspaceId?: string,
  workspaceIds?: string[],
): Promise<ChatRow[]> => {
  const pattern = `%${term}%`;

  const matchingMessages = await db
    .select({ chatId: messages.chatId, content: messages.content })
    .from(messages)
    .where(like(messages.content, pattern));

  const chatIdToExcerpt = new Map<string, string>();
  for (const msg of matchingMessages) {
    if (!chatIdToExcerpt.has(msg.chatId)) {
      chatIdToExcerpt.set(msg.chatId, extractExcerpt(msg.content, term));
    }
  }

  const matchingChatIds = Array.from(chatIdToExcerpt.keys());

  const baseCondition =
    matchingChatIds.length > 0
      ? or(like(chats.title, pattern), inArray(chats.id, matchingChatIds))
      : like(chats.title, pattern);

  const workspaceCondition = buildWorkspaceCondition(workspaceId, workspaceIds);
  const whereCondition = workspaceCondition
    ? and(baseCondition, workspaceCondition)
    : baseCondition;

  const rows = await db
    .select()
    .from(chats)
    .where(whereCondition)
    .orderBy(desc(sql`rowid`));

  return rows.map((chat) => ({
    ...chat,
    matchExcerpt: chatIdToExcerpt.get(chat.id) ?? null,
  }));
};

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
        llm.numCtx = chatModel.ollamaContextWindow || 2048;
      }
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

    // Remove thinking blocks from output (e.g., reasoning models)
    const cleaned = removeThinkingBlocks(rawOutput);

    // The prompt injects the opening <terms> tag, so parse up to </terms>
    const endTagIndex = cleaned.indexOf('</terms>');
    const termsText =
      endTagIndex !== -1 ? cleaned.slice(0, endTagIndex) : cleaned;

    const terms = termsText
      .split('\n')
      .map((line) => line.replace(/^(\s*(-|\*|\d+\.)\s*)+/, '').trim())
      .filter((line) => line.length > 0 && !line.startsWith('<'));

    const searchTerms = terms.length > 0 ? terms : [query.trim()];

    // Search for each term; first match wins for deduplication and excerpt
    const seen = new Map<string, ChatRow>();

    for (const term of searchTerms) {
      const rows = await searchByTerm(term, workspaceId, workspaceIds);
      for (const chat of rows) {
        if (!seen.has(chat.id)) {
          seen.set(chat.id, chat);
        }
      }
    }

    const combinedChats = Array.from(seen.values()).sort(
      (a, b) => b.createdAt - a.createdAt,
    );

    const ids = combinedChats.map((c) => c.id);
    const countRows = ids.length
      ? await db
          .select({
            chatId: messages.chatId,
            count: sql<number>`count(*)`,
          })
          .from(messages)
          .where(inArray(messages.chatId, ids))
          .groupBy(messages.chatId)
      : [];
    const countMap = new Map<string, number>();
    for (const r of countRows) countMap.set(r.chatId, Number(r.count));
    let totalMessages = 0;
    for (const c of combinedChats) {
      c.messageCount = countMap.get(c.id) ?? 0;
      totalMessages += c.messageCount;
    }

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
