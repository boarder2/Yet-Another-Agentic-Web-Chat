'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
  useReducer,
} from 'react';
import {
  useStream,
  FetchStreamTransport,
} from '@langchain/langgraph-sdk/react';
import { encodeHtmlAttribute } from '@/lib/utils/html';
import { Document } from '@langchain/core/documents';
import Navbar from './Navbar';
import Chat from './Chat';
import EmptyChat from './EmptyChat';
import { toast } from 'sonner';
import { useSearchParams, usePathname } from 'next/navigation';
import { getSuggestions } from '@/lib/actions';
import { Settings } from 'lucide-react';
import Link from 'next/link';
import NextError from 'next/error';

export type TokenUsage = {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
};

export type ModelStats = {
  modelName: string;
  responseTime?: number;
  usage?: TokenUsage;
  modelNameChat?: string;
  modelNameSystem?: string;
  usageChat?: TokenUsage;
  usageSystem?: TokenUsage;
  usedLocation?: boolean;
  usedPersonalization?: boolean;
};

export type Message = {
  messageId: string;
  chatId: string;
  createdAt: Date;
  content: string;
  role: 'user' | 'assistant';
  suggestions?: string[];
  sources?: Document[];
  modelStats?: ModelStats;
  searchQuery?: string;
  searchUrl?: string;
  expandedThinkBoxes?: Set<string>;
  usedLocation?: boolean;
  usedPersonalization?: boolean;
  images?: ImageAttachment[];
};

export interface File {
  fileName: string;
  fileExtension: string;
  fileId: string;
}

export interface ImageAttachment {
  imageId: string;
  fileName: string;
  mimeType: string;
}

interface ChatModelProvider {
  name: string;
  provider: string;
}
interface EmbeddingModelProvider {
  name: string;
  provider: string;
}

// Extra data attached to a specific message, populated from custom events
interface MessageExtra {
  sources?: Document[];
  modelStats?: ModelStats;
  searchQuery?: string;
  suggestions?: string[];
}

// Typed interfaces for LangGraph stream internals
interface LGMessage {
  id?: string;
  type: 'human' | 'ai' | 'tool' | 'system';
  role?: string;
  content: unknown;
  tool_calls?: Array<{
    id: string;
    name: string;
    args: Record<string, unknown>;
  }>;
  tool_call_id?: string;
  images?: ImageAttachment[];
}

interface SubagentToolCallData {
  id?: string;
  name: string;
  args?: Record<string, unknown>;
  output?: unknown;
}

interface SubagentData {
  status: 'running' | 'complete' | 'error';
  result?: string;
  error?: unknown;
  toolCall?: { args?: { subagent_type?: string; description?: string } };
  toolCalls?: SubagentToolCallData[];
}

interface StreamRef {
  messages: LGMessage[];
  values: Record<string, unknown>;
  isLoading: boolean;
  stop: () => void;
  submit: (
    input: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => void;
  subagents?: Map<string, SubagentData>;
}

const SEND_LOCATION_KEY = 'personalization.sendLocationEnabled';
const SEND_PROFILE_KEY = 'personalization.sendProfileEnabled';

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return (content as Array<{ type?: string; text?: string }>)
      .filter((c) => c?.type === 'text')
      .map((c) => c.text ?? '')
      .join('');
  }
  return '';
}

const checkConfig = async (
  setChatModelProvider: (p: ChatModelProvider) => void,
  setEmbeddingModelProvider: (p: EmbeddingModelProvider) => void,
  setIsConfigReady: (v: boolean) => void,
  setHasError: (v: boolean) => void,
) => {
  try {
    const chatModelFromStorage = localStorage.getItem('chatModel');
    const chatModelProviderFromStorage =
      localStorage.getItem('chatModelProvider');
    const embeddingModelFromStorage = localStorage.getItem('embeddingModel');
    const embeddingModelProviderFromStorage = localStorage.getItem(
      'embeddingModelProvider',
    );

    const modelsRes = await fetch('/api/models');
    if (!modelsRes.ok) throw new Error('Failed to fetch models');
    const modelsData = await modelsRes.json();

    const chatModelProviders = modelsData.chatModelProviders as Record<
      string,
      Record<string, unknown>
    >;
    const embeddingModelProviders =
      modelsData.embeddingModelProviders as Record<
        string,
        Record<string, unknown>
      >;

    const firstChatProvider = Object.keys(chatModelProviders)[0];
    const firstChatModel =
      chatModelProviders[firstChatProvider] &&
      Object.keys(chatModelProviders[firstChatProvider])[0];

    const firstEmbedProvider = Object.keys(embeddingModelProviders)[0];
    const firstEmbedModel =
      embeddingModelProviders[firstEmbedProvider] &&
      Object.keys(embeddingModelProviders[firstEmbedProvider])[0];

    let resolvedChatProvider =
      chatModelProviderFromStorage || firstChatProvider;
    let resolvedChatModel = chatModelFromStorage || firstChatModel;

    // Validate / fall back
    if (
      !chatModelProviders[resolvedChatProvider] ||
      !chatModelProviders[resolvedChatProvider][resolvedChatModel]
    ) {
      if (resolvedChatProvider === 'custom_openai') {
        const providers = Object.keys(chatModelProviders);
        if (!providers.includes('custom_openai')) {
          toast.error(
            'Cannot use Custom OpenAI: the provider returned no models.',
          );
          setHasError(true);
          setIsConfigReady(false);
          return;
        }
      }
      resolvedChatProvider = firstChatProvider;
      resolvedChatModel = firstChatModel;
    }

    let resolvedEmbedProvider =
      embeddingModelProviderFromStorage || firstEmbedProvider;
    let resolvedEmbedModel = embeddingModelFromStorage || firstEmbedModel;

    if (
      !embeddingModelProviders[resolvedEmbedProvider] ||
      !embeddingModelProviders[resolvedEmbedProvider][resolvedEmbedModel]
    ) {
      resolvedEmbedProvider = firstEmbedProvider;
      resolvedEmbedModel = firstEmbedModel;
    }

    localStorage.setItem('chatModelProvider', resolvedChatProvider);
    localStorage.setItem('chatModel', resolvedChatModel);
    localStorage.setItem('embeddingModelProvider', resolvedEmbedProvider);
    localStorage.setItem('embeddingModel', resolvedEmbedModel);

    setChatModelProvider({
      provider: resolvedChatProvider,
      name: resolvedChatModel,
    });
    setEmbeddingModelProvider({
      provider: resolvedEmbedProvider,
      name: resolvedEmbedModel,
    });
    setIsConfigReady(true);
  } catch {
    setIsConfigReady(false);
    setHasError(true);
  }
};

const ChatWindow = ({ id }: { id?: string }) => {
  const searchParams = useSearchParams();
  const initialMessage = searchParams.get('q');
  const pathname = usePathname();
  const prevPathnameRef = useRef(pathname);

  const generateChatId = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(20)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

  const [chatId, setChatId] = useState<string>(id ?? generateChatId());
  const [newChatCreated] = useState(!id);

  const [chatModelProvider, setChatModelProvider] = useState<ChatModelProvider>(
    {
      name: '',
      provider: '',
    },
  );
  const [embeddingModelProvider, setEmbeddingModelProvider] =
    useState<EmbeddingModelProvider>({ name: '', provider: '' });
  const [isConfigReady, setIsConfigReady] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isMessagesLoaded, setIsMessagesLoaded] = useState(!id);
  const [notFound, setNotFound] = useState(false);

  const [focusMode, setFocusMode] = useState('webSearch');
  const [files, setFiles] = useState<File[]>([]);
  const [fileIds, setFileIds] = useState<string[]>([]);
  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([]);
  const [imageCapable, setImageCapable] = useState(
    () => localStorage?.getItem('imageCapable') === 'true',
  );
  const [systemPromptIds, setSystemPromptIds] = useState<string[]>([]);

  const [sendLocation, setSendLocationState] = useState(false);
  const [sendPersonalization, setSendPersonalizationState] = useState(false);
  const [personalizationLocation, setPersonalizationLocation] = useState('');
  const [personalizationAbout, setPersonalizationAbout] = useState('');

  // Per-message extras (sources, modelStats, suggestions) keyed by LangGraph message ID
  const [messageExtras, setMessageExtras] = useState<
    Record<string, MessageExtra>
  >({});
  const messageExtrasRef = useRef<Record<string, MessageExtra>>({});

  // Preloaded messages from DB for historical chats (useStream only reads initialValues once at mount)
  const [preloadedMessages, setPreloadedMessages] = useState<Message[]>([]);

  // During streaming, accumulate sources and searchQuery for the current turn
  const pendingSourcesRef = useRef<Document[]>([]);
  const pendingSearchQueryRef = useRef<string | undefined>(undefined);
  const [gatheringSources, setGatheringSources] = useState<
    Array<{ searchQuery: string; sources: Document[] }>
  >([]);

  // For respond-now: track the current humanMessageId
  const [, setCurrentHumanMessageId] = useState<string | null>(null);

  // Initial values loaded from DB for historical chats
  const [initialValues, setInitialValues] = useState<{
    messages: unknown[];
  } | null>(null);

  // scrollTrigger for Chat to scroll to bottom
  const [scrollTrigger, setScrollTrigger] = useState(0);

  // Force re-render when messageExtras changes via ref
  const [, _forceUpdate] = useReducer((x: number) => x + 1, 0);

  const setSendLocation = useCallback((value: boolean) => {
    setSendLocationState(value);
    localStorage.setItem(SEND_LOCATION_KEY, value.toString());
  }, []);

  const setSendPersonalization = useCallback((value: boolean) => {
    setSendPersonalizationState(value);
    localStorage.setItem(SEND_PROFILE_KEY, value.toString());
  }, []);

  const refreshPersonalization = useCallback(() => {
    const savedLocation =
      localStorage.getItem('personalization.location') || '';
    const savedAbout = localStorage.getItem('personalization.about') || '';
    setPersonalizationLocation(savedLocation);
    setPersonalizationAbout(savedAbout);
  }, []);

  // Configure useStream with FetchStreamTransport
  const stream = useStream({
    assistantId: 'yaawc', // required by type, not used with FetchStreamTransport
    transport: new FetchStreamTransport({ apiUrl: '/api/chat' }) as Parameters<
      typeof useStream
    >[0]['transport'],
    threadId: chatId,
    messagesKey: 'messages',
    subagentToolNames: ['task'],
    filterSubagentMessages: true,
    initialValues: initialValues as Parameters<
      typeof useStream
    >[0]['initialValues'],
    throttle: false,
    onError: (err: unknown) => {
      console.error('Stream error:', err);
      toast.error('An error occurred while generating a response.');
    },
    onCustomEvent: (event: unknown) => {
      const e = event as Record<string, unknown>;
      if (e.type === 'sources_added') {
        const docs = (e.data as Document[]) ?? [];
        pendingSourcesRef.current.push(...docs);
        if (typeof e.searchQuery === 'string') {
          pendingSearchQueryRef.current = e.searchQuery;
        }
        setGatheringSources((prev) => {
          const sq = (e.searchQuery as string) ?? '';
          const existing = prev.find((g) => g.searchQuery === sq);
          if (existing) {
            return prev.map((g) =>
              g.searchQuery === sq
                ? { ...g, sources: [...g.sources, ...docs] }
                : g,
            );
          }
          return [...prev, { searchQuery: sq, sources: docs }];
        });
      } else if (e.type === 'messageEnd') {
        const sources = [...pendingSourcesRef.current];
        const searchQuery = pendingSearchQueryRef.current;
        const modelStats = e.modelStats as ModelStats | undefined;
        const aiMsgId = e.messageId as string | undefined;
        const humanMsgId = e.humanMessageId as string | undefined;

        // Find the last AI message from stream to associate extras with
        const currentMessages = stream.messages;
        const lastAiMsg = [...currentMessages]
          .reverse()
          .find((m: LGMessage) => m.type === 'ai' || m.role === 'assistant');
        const lastAiMsgId = lastAiMsg?.id ?? aiMsgId ?? '';

        if (lastAiMsgId) {
          const extra: MessageExtra = {
            sources,
            modelStats,
            searchQuery,
          };
          messageExtrasRef.current = {
            ...messageExtrasRef.current,
            [lastAiMsgId]: extra,
          };
          setMessageExtras({ ...messageExtrasRef.current });
        }

        pendingSourcesRef.current = [];
        pendingSearchQueryRef.current = undefined;
        setGatheringSources([]);
        setCurrentHumanMessageId(null);

        // Fetch auto-suggestions
        if (humanMsgId) {
          const autoSuggestions = localStorage.getItem('autoSuggestions');
          if (autoSuggestions !== 'false' && sources.length > 0) {
            getSuggestions(
              stream.messages.map((m: LGMessage) => ({
                messageId: m.id ?? '',
                chatId: chatId ?? '',
                createdAt: new Date(),
                content: extractText(m.content),
                role:
                  m.type === 'human'
                    ? ('user' as const)
                    : ('assistant' as const),
              })),
            ).then((suggestions) => {
              if (suggestions && lastAiMsgId) {
                messageExtrasRef.current = {
                  ...messageExtrasRef.current,
                  [lastAiMsgId]: {
                    ...messageExtrasRef.current[lastAiMsgId],
                    suggestions,
                  },
                };
                setMessageExtras({ ...messageExtrasRef.current });
              }
            });
          }
        }
      }
    },
  } as Parameters<typeof useStream>[0]) as unknown as StreamRef;

  // Ref to track current stream messages for use in callbacks
  const streamMessagesRef = useRef<LGMessage[]>([]);
  useEffect(() => {
    streamMessagesRef.current = stream.messages ?? [];
  }, [stream.messages]);

  // Transform stream.messages (LangGraph format) → Message[] (display format)
  const messages = useMemo((): Message[] => {
    const streamMsgs = stream.messages ?? [];
    if (streamMsgs.length === 0) return [];

    const result: Message[] = [];

    // Collect completed tool call IDs (from ToolMessages)
    const completedToolCallIds = new Set<string>(
      streamMsgs
        .filter((m) => m.type === 'tool' && m.tool_call_id)
        .map((m) => m.tool_call_id as string),
    );

    // Get subagents map
    const subagentsMap = stream.subagents ?? new Map<string, SubagentData>();

    let pendingToolCalls: Array<{
      id: string;
      name: string;
      args: Record<string, unknown>;
    }> = [];
    let pendingContent = '';
    let pendingMsgId = '';
    let pendingSubagentIds: string[] = [];

    const streamIsLoading = stream.isLoading;
    const buildToolCallMarkup = (
      tcs: Array<{ id: string; name: string; args: Record<string, unknown> }>,
    ) => {
      return tcs
        .map((tc) => {
          const completed = completedToolCallIds.has(tc.id ?? '');
          const status = completed
            ? 'success'
            : streamIsLoading
              ? 'running'
              : 'error';
          let attrs = `type="${tc.name}" status="${status}" toolCallId="${tc.id ?? ''}"`;
          if (tc.args?.query)
            attrs += ` query="${encodeHtmlAttribute(String(tc.args.query))}"`;
          if (tc.args?.url)
            attrs += ` url="${encodeHtmlAttribute(String(tc.args.url))}"`;
          if (Array.isArray(tc.args?.urls) && tc.args.urls.length > 0)
            attrs += ` count="${tc.args.urls.length}"`;
          if (!completed && !streamIsLoading)
            attrs += ` error="Request stopped"`;
          return `<ToolCall ${attrs}></ToolCall>`;
        })
        .join('\n');
    };

    const buildSubagentMarkup = (subagentIds: string[]) => {
      return subagentIds
        .map((saId) => {
          const sa = subagentsMap.get(saId);
          if (!sa) return '';
          const saName = sa.toolCall?.args?.subagent_type ?? 'Research';
          const saTask = sa.toolCall?.args?.description ?? '';
          const saStatus =
            sa.status === 'complete'
              ? 'success'
              : sa.status === 'error'
                ? 'error'
                : streamIsLoading
                  ? 'running'
                  : 'error';
          let attrs = `id="${saId}" name="${encodeHtmlAttribute(saName)}" task="${encodeHtmlAttribute(saTask)}" status="${saStatus}"`;
          if (sa.result && sa.status === 'complete') {
            attrs += ` summary="${encodeHtmlAttribute(sa.result)}"`;
          }
          if (sa.error) {
            attrs += ` error="${encodeHtmlAttribute(String(sa.error))}"`;
          }
          // Nested tool calls inside subagent
          const saToolCalls = sa.toolCalls ?? [];
          const nestedMarkup = saToolCalls
            .map((stc: SubagentToolCallData) => {
              const stcStatus =
                stc.output !== undefined ? 'success' : 'running';
              let stcAttrs = `type="${stc.name}" status="${stcStatus}" toolCallId="${stc.id ?? ''}"`;
              if (stc.args?.query)
                stcAttrs += ` query="${encodeHtmlAttribute(String(stc.args.query))}"`;
              if (stc.args?.url)
                stcAttrs += ` url="${encodeHtmlAttribute(String(stc.args.url))}"`;
              if (Array.isArray(stc.args?.urls) && stc.args.urls.length > 0)
                stcAttrs += ` count="${stc.args.urls.length}"`;
              return `<ToolCall ${stcAttrs}></ToolCall>`;
            })
            .join('\n');
          return `<SubagentExecution ${attrs}>${nestedMarkup}</SubagentExecution>`;
        })
        .join('\n');
    };

    const flushAssistant = () => {
      if (
        !pendingContent &&
        pendingToolCalls.length === 0 &&
        pendingSubagentIds.length === 0
      ) {
        pendingToolCalls = [];
        pendingContent = '';
        pendingMsgId = '';
        pendingSubagentIds = [];
        return;
      }
      const toolCallMarkup = buildToolCallMarkup(pendingToolCalls);
      const subagentMarkup = buildSubagentMarkup(pendingSubagentIds);
      const fullContent = [subagentMarkup, toolCallMarkup, pendingContent]
        .filter(Boolean)
        .join('\n');

      const extra = messageExtras[pendingMsgId] ?? {};
      result.push({
        messageId: pendingMsgId || `ast-${result.length}`,
        chatId: chatId ?? '',
        createdAt: new Date(),
        content: fullContent,
        role: 'assistant',
        sources: extra.sources,
        modelStats: extra.modelStats,
        searchQuery: extra.searchQuery,
        suggestions: extra.suggestions,
      });
      pendingToolCalls = [];
      pendingContent = '';
      pendingMsgId = '';
      pendingSubagentIds = [];
    };

    for (const msg of streamMsgs) {
      if (msg.type === 'human') {
        flushAssistant();
        result.push({
          messageId: msg.id ?? `human-${result.length}`,
          chatId: chatId ?? '',
          createdAt: new Date(),
          content: extractText(msg.content),
          role: 'user',
          images: msg.images as ImageAttachment[] | undefined,
        });
      } else if (msg.type === 'ai') {
        const msgToolCalls: Array<{
          id: string;
          name: string;
          args: Record<string, unknown>;
        }> = (msg.tool_calls ?? []).filter(
          (tc) => tc.name !== 'write_todos' && tc.name !== 'task',
        );
        const subagentToolCalls = (msg.tool_calls ?? []).filter(
          (tc) => tc.name === 'task',
        );

        if (msgToolCalls.length > 0) {
          pendingToolCalls.push(...msgToolCalls);
        }
        // Track subagent IDs to render
        for (const stc of subagentToolCalls) {
          if (stc.id) pendingSubagentIds.push(stc.id);
        }
        const text = extractText(msg.content);
        if (text) {
          pendingContent = text;
        }
        if (msg.id) pendingMsgId = msg.id;
      }
      // Skip tool messages (used only for status tracking)
    }
    flushAssistant();

    return result;
  }, [
    stream.messages,
    stream.subagents,
    stream.isLoading,
    chatId,
    messageExtras,
  ]);

  // Use preloadedMessages (from DB) when useStream has not yet populated messages
  const displayMessages = messages.length > 0 ? messages : preloadedMessages;

  // Todos from stream state values — only shown while streaming is active
  const todoItems = useMemo(() => {
    if (!stream.isLoading) return [];
    const todos = stream.values.todos;
    if (!Array.isArray(todos)) return [];
    return todos as Array<{ content: string; status: string }>;
  }, [stream.values, stream.isLoading]);

  // Live model stats (used by Chat while loading)
  const liveModelStats = useMemo((): ModelStats | null => {
    if (!stream.isLoading) return null;
    // Extract token usage from the latest AI message's response_metadata
    const msgs = (stream.messages ?? []) as Array<
      LGMessage & { response_metadata?: Record<string, unknown> }
    >;
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.type === 'ai' && m.response_metadata) {
        const meta = m.response_metadata;
        // OpenAI / LM Studio format
        const tu = meta.tokenUsage as Record<string, unknown> | undefined;
        if (tu) {
          const inputT = Number(tu.promptTokens ?? 0);
          const outputT = Number(tu.completionTokens ?? 0);
          const totalT = Number(tu.totalTokens ?? inputT + outputT);
          if (inputT + outputT > 0) {
            return {
              modelName: chatModelProvider.name,
              modelNameChat: chatModelProvider.name,
              usageChat: {
                input_tokens: inputT,
                output_tokens: outputT,
                total_tokens: totalT,
              },
            };
          }
        }
        // Anthropic / other format
        const usage = meta.usage as Record<string, unknown> | undefined;
        if (usage) {
          const inputT = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0);
          const outputT = Number(
            usage.output_tokens ?? usage.completion_tokens ?? 0,
          );
          const totalT = Number(usage.total_tokens ?? inputT + outputT);
          if (inputT + outputT > 0) {
            return {
              modelName: chatModelProvider.name,
              modelNameChat: chatModelProvider.name,
              usageChat: {
                input_tokens: inputT,
                output_tokens: outputT,
                total_tokens: totalT,
              },
            };
          }
        }
      }
    }
    return null;
  }, [stream.messages, stream.isLoading, chatModelProvider.name]);

  // Load configuration on mount
  useEffect(() => {
    checkConfig(
      setChatModelProvider,
      setEmbeddingModelProvider,
      setIsConfigReady,
      setHasError,
    );
  }, []);

  // Load historical messages for existing chats
  useEffect(() => {
    if (!id || newChatCreated) return;

    const loadInitialMessages = async () => {
      try {
        const res = await fetch(`/api/chats/${id}`);
        if (!res.ok) {
          if (res.status === 404) setNotFound(true);
          setIsMessagesLoaded(true);
          return;
        }
        const data = await res.json();
        const chatData = data.chat;
        const messagesData = data.messages as Array<{
          messageId: string;
          role: string;
          content: string;
          metadata?: Record<string, unknown>;
        }>;

        // Set chat title
        if (messagesData.length > 0) {
          document.title = messagesData[0].content.slice(0, 60);
        }

        // Set focus mode and files
        if (chatData?.focusMode) setFocusMode(chatData.focusMode);
        if (chatData?.files && Array.isArray(chatData.files)) {
          const chatFiles: File[] = chatData.files.map(
            (f: { name?: string; fileId?: string }) => ({
              fileName: f.name ?? '',
              fileExtension: (f.name ?? '').split('.').pop() ?? '',
              fileId: f.fileId ?? '',
            }),
          );
          setFiles(chatFiles);
          setFileIds(chatFiles.map((f) => f.fileId));
        }

        // Pre-populate messageExtras from DB metadata
        const extras: Record<string, MessageExtra> = {};
        for (const m of messagesData) {
          if (m.role === 'assistant' && m.metadata) {
            const meta = m.metadata as Record<string, unknown>;
            extras[m.messageId] = {
              sources: meta.sources as Document[] | undefined,
              modelStats: meta.modelStats as ModelStats | undefined,
              searchQuery: meta.searchQuery as string | undefined,
            };
          }
        }
        messageExtrasRef.current = extras;
        setMessageExtras(extras);

        // Build initialValues for useStream
        const lgMessages = messagesData.map((m) => ({
          id: m.messageId,
          type: m.role === 'user' ? 'human' : 'ai',
          content: m.content,
        }));
        setInitialValues({ messages: lgMessages });

        // Build preloaded messages for immediate display (useStream initialValues is only read once)
        const preloaded: Message[] = messagesData.map((m) => ({
          messageId: m.messageId,
          chatId: id,
          createdAt: new Date(),
          content: m.content,
          role: m.role === 'user' ? 'user' : 'assistant',
          sources: extras[m.messageId]?.sources,
          modelStats: extras[m.messageId]?.modelStats,
          searchQuery: extras[m.messageId]?.searchQuery,
        }));
        setPreloadedMessages(preloaded);
      } catch (err) {
        console.error('Failed to load chat history:', err);
      } finally {
        setIsMessagesLoaded(true);
      }
    };

    loadInitialMessages();
  }, [id, newChatCreated]);

  // Ready once both config and messages are loaded
  useEffect(() => {
    if (isConfigReady && isMessagesLoaded) {
      setIsReady(true);
    }
  }, [isConfigReady, isMessagesLoaded]);

  // Navigation reset: when returning to '/' for a new chat
  useEffect(() => {
    if (pathname === prevPathnameRef.current) return;
    prevPathnameRef.current = pathname;
    if (pathname === '/' && !id) {
      setChatId(generateChatId());
      setFocusMode('webSearch');
      setFiles([]);
      setFileIds([]);
      setPendingImages([]);
      setSystemPromptIds([]);
      setGatheringSources([]);
      setMessageExtras({});
      messageExtrasRef.current = {};
      pendingSourcesRef.current = [];
      pendingSearchQueryRef.current = undefined;
      setInitialValues(null);
      setIsMessagesLoaded(true);
      setNotFound(false);
      document.title = 'YAAWC';
    }
  }, [pathname, id]);

  // Personalization setup
  useEffect(() => {
    const stored = localStorage.getItem(SEND_LOCATION_KEY);
    const storedProfile = localStorage.getItem(SEND_PROFILE_KEY);
    if (stored === 'true') setSendLocationState(true);
    if (storedProfile === 'true') setSendPersonalizationState(true);
  }, []);

  useEffect(() => {
    if (!personalizationLocation && sendLocation) setSendLocationState(false);
  }, [personalizationLocation, sendLocation]);

  useEffect(() => {
    if (!personalizationAbout && sendPersonalization)
      setSendPersonalizationState(false);
  }, [personalizationAbout, sendPersonalization]);

  useEffect(() => {
    refreshPersonalization();
    const handleUpdate = () => refreshPersonalization();
    window.addEventListener('storage', handleUpdate);
    window.addEventListener('focus', handleUpdate);
    window.addEventListener('personalization-update', handleUpdate);
    return () => {
      window.removeEventListener('storage', handleUpdate);
      window.removeEventListener('focus', handleUpdate);
      window.removeEventListener('personalization-update', handleUpdate);
    };
  }, [refreshPersonalization]);

  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'imageCapable') {
        setImageCapable(e.newValue === 'true');
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Auto-scroll when messages change
  useEffect(() => {
    setScrollTrigger((t) => t + 1);
  }, [messages.length]);

  // Auto-send initial message from ?q= param
  const initialMessageSentRef = useRef(false);
  useEffect(() => {
    if (
      isReady &&
      isConfigReady &&
      initialMessage &&
      !initialMessageSentRef.current
    ) {
      initialMessageSentRef.current = true;
      sendMessage(initialMessage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, isConfigReady, initialMessage]);

  const sendMessage = async (
    message: string,
    options?: {
      messageId?: string;
      suggestions?: string[];
      editMode?: boolean;
      images?: ImageAttachment[];
    },
  ) => {
    // Suggestion-only shortcut
    if (options?.suggestions && options?.messageId && !message) {
      setMessageExtras((prev) => ({
        ...prev,
        [options.messageId!]: {
          ...(prev[options.messageId!] ?? {}),
          suggestions: options.suggestions,
        },
      }));
      return;
    }

    if (stream.isLoading || !isConfigReady) return;

    const humanMessageId =
      options?.messageId ??
      Array.from(crypto.getRandomValues(new Uint8Array(7)))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

    setCurrentHumanMessageId(humanMessageId);
    setGatheringSources([]);
    pendingSourcesRef.current = [];
    pendingSearchQueryRef.current = undefined;

    const imageAttachments =
      options?.images ?? (options?.editMode ? [] : pendingImages);
    if (!options?.editMode) setPendingImages([]);

    // Update browser URL to include chatId for new chats
    if (
      typeof window !== 'undefined' &&
      !window.location.pathname.startsWith('/c/')
    ) {
      window.history.replaceState({}, '', `/c/${chatId}`);
      document.title = message.slice(0, 60);
    }

    // Read fresh model config from localStorage at send time
    const chatModelStr =
      localStorage.getItem('chatModel') || chatModelProvider.name;
    const chatModelProviderStr =
      localStorage.getItem('chatModelProvider') || chatModelProvider.provider;
    const systemModelStr = localStorage.getItem('systemModel') || chatModelStr;
    const systemModelProviderStr =
      localStorage.getItem('systemModelProvider') || chatModelProviderStr;
    const linkSystemToChat =
      localStorage.getItem('linkSystemToChat') === 'true';
    const embeddingModelStr =
      localStorage.getItem('embeddingModel') || embeddingModelProvider.name;
    const embeddingModelProviderStr =
      localStorage.getItem('embeddingModelProvider') ||
      embeddingModelProvider.provider;
    const ollamaContextWindow = parseInt(
      localStorage.getItem('ollamaContextWindow') ?? '2048',
      10,
    );

    const chatModelConfig = {
      provider: chatModelProviderStr,
      name: chatModelStr,
      ...(chatModelProviderStr === 'ollama' && { ollamaContextWindow }),
    };
    const systemModelConfig = linkSystemToChat
      ? chatModelConfig
      : {
          provider: systemModelProviderStr,
          name: systemModelStr,
          ...(systemModelProviderStr === 'ollama' && { ollamaContextWindow }),
        };
    const embeddingModelConfig = {
      provider: embeddingModelProviderStr,
      name: embeddingModelStr,
    };

    const configurable: Record<string, unknown> = {
      thread_id: chatId,
      focusMode,
      chatModel: chatModelConfig,
      systemModel: systemModelConfig,
      embeddingModel: embeddingModelConfig,
      selectedSystemPromptIds: systemPromptIds,
      files: files.map((f) => f.fileId),
      fileIds,
      humanMessageId,
    };

    if (sendLocation && personalizationLocation) {
      configurable.userLocation = personalizationLocation;
    }
    if (sendPersonalization && personalizationAbout) {
      configurable.userProfile = personalizationAbout;
    }
    if (imageAttachments.length > 0) {
      configurable.messageImageIds = imageAttachments.map((img) => img.imageId);
      configurable.messageImages = imageAttachments;
    }

    await stream.submit(
      { messages: [{ role: 'human', content: message, id: humanMessageId }] },
      { config: { configurable } },
    );
  };

  const rewrite = (messageId: string) => {
    const msgIndex = displayMessages.findIndex(
      (m) => m.messageId === messageId,
    );
    if (msgIndex === -1) return;
    // Find the preceding user message
    for (let i = msgIndex - 1; i >= 0; i--) {
      if (displayMessages[i].role === 'user') {
        sendMessage(displayMessages[i].content, {
          messageId: displayMessages[i].messageId,
        });
        return;
      }
    }
  };

  const handleEditMessage = async (
    messageId: string,
    newContent: string,
    images?: ImageAttachment[],
  ) => {
    sendMessage(newContent, { messageId, editMode: true, images });
  };

  const handleThinkBoxToggle = (
    messageId: string,
    thinkBoxId: string,
    expanded: boolean,
  ) => {
    setMessageExtras((prev) => {
      // expandedThinkBoxes is not tracked in extras; we keep this as a Message field
      return prev; // No-op: think box state is managed within each Message render
    });
    // Directly update the message in-place if we had a mutable structure
    // For now think box state is handled locally in ThinkBox component
    void messageId;
    void thinkBoxId;
    void expanded;
  };

  // Error page
  if (hasError) {
    return (
      <div className="relative">
        <div className="absolute w-full flex flex-row items-center justify-end mr-5 mt-5">
          <Link href="/settings">
            <Settings className="cursor-pointer lg:hidden" />
          </Link>
        </div>
        <div className="flex flex-col items-center justify-center min-h-screen">
          <p className="text-sm">
            Failed to connect to the server. Please try again later.
          </p>
        </div>
      </div>
    );
  }

  // Loading spinner
  if (!isReady) {
    return (
      <div className="flex flex-row items-center justify-center min-h-screen">
        <svg
          aria-hidden="true"
          className="w-8 h-8 text-surface-2 animate-spin fill-accent"
          viewBox="0 0 100 101"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 45.3213 27.9921 45.3213 50.5908Z"
            fill="currentColor"
          />
          <path
            d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.7065 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.51521 51.7191 9.52806 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z"
            fill="currentFill"
          />
        </svg>
      </div>
    );
  }

  if (notFound) {
    return <NextError statusCode={404} />;
  }

  return (
    <div>
      {displayMessages.length > 0 ? (
        <>
          <Navbar chatId={chatId!} messages={displayMessages} />
          <Chat
            loading={stream.isLoading}
            messages={displayMessages}
            sendMessage={sendMessage}
            scrollTrigger={scrollTrigger}
            rewrite={rewrite}
            fileIds={fileIds}
            setFileIds={setFileIds}
            files={files}
            setFiles={setFiles}
            focusMode={focusMode}
            setFocusMode={setFocusMode}
            handleEditMessage={handleEditMessage}
            analysisProgress={null}
            modelStats={liveModelStats}
            systemPromptIds={systemPromptIds}
            setSystemPromptIds={setSystemPromptIds}
            onThinkBoxToggle={handleThinkBoxToggle}
            gatheringSources={gatheringSources}
            sendLocation={sendLocation}
            setSendLocation={setSendLocation}
            sendPersonalization={sendPersonalization}
            setSendPersonalization={setSendPersonalization}
            personalizationLocation={personalizationLocation}
            personalizationAbout={personalizationAbout}
            refreshPersonalization={refreshPersonalization}
            todoItems={todoItems}
            pendingImages={pendingImages}
            setPendingImages={setPendingImages}
            imageCapable={imageCapable}
          />
        </>
      ) : (
        <EmptyChat
          sendMessage={sendMessage}
          focusMode={focusMode}
          setFocusMode={setFocusMode}
          systemPromptIds={systemPromptIds}
          setSystemPromptIds={setSystemPromptIds}
          fileIds={fileIds}
          setFileIds={setFileIds}
          files={files}
          setFiles={setFiles}
          sendLocation={sendLocation}
          setSendLocation={setSendLocation}
          sendPersonalization={sendPersonalization}
          setSendPersonalization={setSendPersonalization}
          personalizationLocation={personalizationLocation}
          personalizationAbout={personalizationAbout}
          refreshPersonalization={refreshPersonalization}
          pendingImages={pendingImages}
          setPendingImages={setPendingImages}
          imageCapable={imageCapable}
        />
      )}
    </div>
  );
};

export default ChatWindow;
