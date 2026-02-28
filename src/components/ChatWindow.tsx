'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useStream,
  FetchStreamTransport,
} from '@langchain/langgraph-sdk/react';
import type {
  Message as LangGraphMessage,
  AIMessage as LangGraphAIMessage,
  ToolMessage as LangGraphToolMessage,
} from '@langchain/langgraph-sdk';
import { Document } from '@langchain/core/documents';
import { escapeAttribute } from '@/lib/utils/toolCallMarkup';
import Navbar from './Navbar';
import Chat from './Chat';
import EmptyChat from './EmptyChat';
import crypto from 'crypto';
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
  // Back-compat fields
  modelName: string; // chat model name (legacy)
  responseTime?: number;
  usage?: TokenUsage; // total usage (legacy)
  // New fields for separate tracking
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
  progress?: {
    message: string;
    current: number;
    total: number;
    subMessage?: string;
  };
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

const SEND_LOCATION_KEY = 'personalization.sendLocationEnabled';
const SEND_PROFILE_KEY = 'personalization.sendProfileEnabled';

const checkConfig = async (
  setChatModelProvider: (provider: ChatModelProvider) => void,
  setEmbeddingModelProvider: (provider: EmbeddingModelProvider) => void,
  setIsConfigReady: (ready: boolean) => void,
  setHasError: (hasError: boolean) => void,
) => {
  try {
    let chatModel = localStorage.getItem('chatModel');
    let chatModelProvider = localStorage.getItem('chatModelProvider');
    let embeddingModel = localStorage.getItem('embeddingModel');
    let embeddingModelProvider = localStorage.getItem('embeddingModelProvider');

    const providers = await fetch(`/api/models`, {
      headers: {
        'Content-Type': 'application/json',
      },
    }).then(async (res) => {
      if (!res.ok)
        throw new Error(
          `Failed to fetch models: ${res.status} ${res.statusText}`,
        );
      return res.json();
    });

    if (
      !chatModel ||
      !chatModelProvider ||
      !embeddingModel ||
      !embeddingModelProvider
    ) {
      if (!chatModel || !chatModelProvider) {
        const chatModelProviders = providers.chatModelProviders;
        const chatModelProvidersKeys = Object.keys(chatModelProviders);

        if (!chatModelProviders || chatModelProvidersKeys.length === 0) {
          return toast.error('No chat models available');
        } else {
          chatModelProvider =
            chatModelProvidersKeys.find(
              (provider) =>
                Object.keys(chatModelProviders[provider]).length > 0,
            ) || chatModelProvidersKeys[0];
        }

        if (
          chatModelProvider === 'custom_openai' &&
          Object.keys(chatModelProviders[chatModelProvider]).length === 0
        ) {
          toast.error(
            "Looks like you haven't configured any chat model providers. Please configure them from the settings page or the config file.",
          );
          return setHasError(true);
        }

        chatModel = Object.keys(chatModelProviders[chatModelProvider])[0];
      }

      if (!embeddingModel || !embeddingModelProvider) {
        const embeddingModelProviders = providers.embeddingModelProviders;

        if (
          !embeddingModelProviders ||
          Object.keys(embeddingModelProviders).length === 0
        )
          return toast.error('No embedding models available');

        embeddingModelProvider = Object.keys(embeddingModelProviders)[0];
        embeddingModel = Object.keys(
          embeddingModelProviders[embeddingModelProvider],
        )[0];
      }

      localStorage.setItem('chatModel', chatModel!);
      localStorage.setItem('chatModelProvider', chatModelProvider);
      localStorage.setItem('embeddingModel', embeddingModel!);
      localStorage.setItem('embeddingModelProvider', embeddingModelProvider);
    } else {
      const chatModelProviders = providers.chatModelProviders;
      const embeddingModelProviders = providers.embeddingModelProviders;

      if (
        Object.keys(chatModelProviders).length > 0 &&
        (!chatModelProviders[chatModelProvider] ||
          Object.keys(chatModelProviders[chatModelProvider]).length === 0)
      ) {
        const chatModelProvidersKeys = Object.keys(chatModelProviders);
        chatModelProvider =
          chatModelProvidersKeys.find(
            (key) => Object.keys(chatModelProviders[key]).length > 0,
          ) || chatModelProvidersKeys[0];

        localStorage.setItem('chatModelProvider', chatModelProvider);
      }

      if (
        chatModelProvider &&
        !chatModelProviders[chatModelProvider][chatModel]
      ) {
        if (
          chatModelProvider === 'custom_openai' &&
          Object.keys(chatModelProviders[chatModelProvider]).length === 0
        ) {
          toast.error(
            "Looks like you haven't configured any chat model providers. Please configure them from the settings page or the config file.",
          );
          return setHasError(true);
        }

        chatModel = Object.keys(
          chatModelProviders[
            Object.keys(chatModelProviders[chatModelProvider]).length > 0
              ? chatModelProvider
              : Object.keys(chatModelProviders)[0]
          ],
        )[0];

        localStorage.setItem('chatModel', chatModel);
      }

      if (
        Object.keys(embeddingModelProviders).length > 0 &&
        !embeddingModelProviders[embeddingModelProvider]
      ) {
        embeddingModelProvider = Object.keys(embeddingModelProviders)[0];
        localStorage.setItem('embeddingModelProvider', embeddingModelProvider);
      }

      if (
        embeddingModelProvider &&
        !embeddingModelProviders[embeddingModelProvider][embeddingModel]
      ) {
        embeddingModel = Object.keys(
          embeddingModelProviders[embeddingModelProvider],
        )[0];
        localStorage.setItem('embeddingModel', embeddingModel);
      }
    }

    setChatModelProvider({
      name: chatModel!,
      provider: chatModelProvider,
    });

    setEmbeddingModelProvider({
      name: embeddingModel!,
      provider: embeddingModelProvider,
    });

    setIsConfigReady(true);
  } catch (err) {
    console.error('An error occurred while checking the configuration:', err);
    setIsConfigReady(false);
    setHasError(true);
  }
};

const loadMessages = async (
  chatId: string,
  setMessages: (messages: Message[]) => void,
  setIsMessagesLoaded: (loaded: boolean) => void,
  setChatHistory: (history: [string, string, string[]?][]) => void,
  setFocusMode: (mode: string) => void,
  setNotFound: (notFound: boolean) => void,
  setFiles: (files: File[]) => void,
  setFileIds: (fileIds: string[]) => void,
) => {
  const res = await fetch(`/api/chats/${chatId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (res.status === 404) {
    setNotFound(true);
    setIsMessagesLoaded(true);
    return;
  }

  const data = await res.json();

  const messages = data.messages.map((msg: unknown) => {
    const raw = msg as Record<string, unknown>;
    const meta = JSON.parse(raw.metadata as string) as Record<string, unknown>;
    // Wrap plain source objects from DB into Document-like shape
    if (Array.isArray(meta.sources)) {
      meta.sources = (meta.sources as Array<Record<string, unknown>>).map(
        (s) => {
          if (s.metadata) return s; // already a Document
          return {
            pageContent: '',
            metadata: {
              url: s.url || '',
              title: s.title || '',
              ...(s.sourceId !== undefined ? { sourceId: s.sourceId } : {}),
            },
          };
        },
      );
    }
    return { ...raw, ...meta };
  }) as Message[];

  setMessages(messages);

  const history = messages.map((msg) => {
    const entry: [string, string, string[]?] = [msg.role, msg.content];
    if (msg.role === 'user' && msg.images && msg.images.length > 0) {
      entry[2] = msg.images.map((img: ImageAttachment) => img.imageId);
    }
    return entry;
  }) as [string, string, string[]?][];

  console.debug(new Date(), 'app:messages_loaded');

  document.title = messages[0].content;

  const files = data.chat.files.map((file: Record<string, string>) => {
    return {
      fileName: file.name,
      fileExtension: file.name.split('.').pop(),
      fileId: file.fileId,
    };
  });

  setFiles(files);
  setFileIds(files.map((file: File) => file.fileId));

  setChatHistory(history);
  setFocusMode(data.chat.focusMode);
  setIsMessagesLoaded(true);
};

const ChatWindow = ({ id }: { id?: string }) => {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const initialMessage = searchParams.get('q');

  const [chatId, setChatId] = useState<string | undefined>(id);
  const [newChatCreated, setNewChatCreated] = useState(false);

  const [chatModelProvider, setChatModelProvider] = useState<ChatModelProvider>(
    {
      name: '',
      provider: '',
    },
  );

  const [embeddingModelProvider, setEmbeddingModelProvider] =
    useState<EmbeddingModelProvider>({
      name: '',
      provider: '',
    });
  // Note: System model is only selectable in Settings; we read from localStorage at send time

  const [isConfigReady, setIsConfigReady] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    checkConfig(
      setChatModelProvider,
      setEmbeddingModelProvider,
      setIsConfigReady,
      setHasError,
    );
  }, []);

  const [loading, setLoading] = useState(false);
  const [scrollTrigger, setScrollTrigger] = useState(0);
  const [analysisProgress, setAnalysisProgress] = useState<{
    message: string;
    current: number;
    total: number;
    subMessage?: string;
  } | null>(null);
  const [liveModelStats, setLiveModelStats] = useState<ModelStats | null>(null);

  const [chatHistory, setChatHistory] = useState<[string, string, string[]?][]>(
    [],
  );
  const [messages, setMessages] = useState<Message[]>([]);

  const [todoItems, setTodoItems] = useState<
    Array<{ content: string; status: string }>
  >([]);

  const [files, setFiles] = useState<File[]>([]);
  const [fileIds, setFileIds] = useState<string[]>([]);

  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([]);

  const [imageCapable, setImageCapable] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('imageCapable') === 'true';
  });

  const [focusMode, setFocusMode] = useState('webSearch');
  const [systemPromptIds, setSystemPromptIds] = useState<string[]>([]);

  const [isMessagesLoaded, setIsMessagesLoaded] = useState(false);

  const [notFound, setNotFound] = useState(false);

  // State for tracking sources during gathering phase
  const [gatheringSources, setGatheringSources] = useState<
    Array<{
      searchQuery: string;
      sources: Document[];
    }>
  >([]);

  const [sendLocation, setSendLocationState] = useState(false);
  const [sendPersonalization, setSendPersonalizationState] = useState(false);
  const [personalizationLocation, setPersonalizationLocation] = useState('');
  const [personalizationAbout, setPersonalizationAbout] = useState('');

  const setSendLocation = useCallback(
    (value: boolean) => {
      setSendLocationState(value);
      if (typeof window !== 'undefined') {
        localStorage.setItem(SEND_LOCATION_KEY, value.toString());
      }
    },
    [setSendLocationState],
  );

  const setSendPersonalization = useCallback(
    (value: boolean) => {
      setSendPersonalizationState(value);
      if (typeof window !== 'undefined') {
        localStorage.setItem(SEND_PROFILE_KEY, value.toString());
      }
    },
    [setSendPersonalizationState],
  );

  const refreshPersonalization = useCallback(() => {
    if (typeof window === 'undefined') return;
    const savedLocation =
      localStorage.getItem('personalization.location') || '';
    const savedAbout = localStorage.getItem('personalization.about') || '';
    setPersonalizationLocation(savedLocation);
    setPersonalizationAbout(savedAbout);
  }, []);

  useEffect(() => {
    refreshPersonalization();
    if (typeof window === 'undefined') return;

    const handleStorage = () => refreshPersonalization();
    const handleFocus = () => refreshPersonalization();
    const handleCustom: EventListener = () => refreshPersonalization();

    window.addEventListener('storage', handleStorage);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('personalization-update', handleCustom);

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('personalization-update', handleCustom);
    };
  }, [refreshPersonalization]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleImageCapableStorage = () => {
      setImageCapable(localStorage.getItem('imageCapable') === 'true');
    };
    window.addEventListener('storage', handleImageCapableStorage);
    return () => {
      window.removeEventListener('storage', handleImageCapableStorage);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedSendLocation = localStorage.getItem(SEND_LOCATION_KEY);
    const storedSendProfile = localStorage.getItem(SEND_PROFILE_KEY);

    if (storedSendLocation !== null) {
      setSendLocation(storedSendLocation === 'true');
    }
    if (storedSendProfile !== null) {
      setSendPersonalization(storedSendProfile === 'true');
    }
  }, [setSendLocation, setSendPersonalization]);

  useEffect(() => {
    if (personalizationLocation.trim() === '' && sendLocation) {
      setSendLocation(false);
    }
  }, [personalizationLocation, sendLocation, setSendLocation]);

  useEffect(() => {
    if (personalizationAbout.trim() === '' && sendPersonalization) {
      setSendPersonalization(false);
    }
  }, [personalizationAbout, sendPersonalization, setSendPersonalization]);

  useEffect(() => {
    if (
      chatId &&
      !newChatCreated &&
      !isMessagesLoaded &&
      messages.length === 0
    ) {
      loadMessages(
        chatId,
        setMessages,
        setIsMessagesLoaded,
        setChatHistory,
        setFocusMode,
        setNotFound,
        setFiles,
        setFileIds,
      );
    } else if (!chatId) {
      setNewChatCreated(true);
      setIsMessagesLoaded(true);
      setChatId(crypto.randomBytes(20).toString('hex'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const messagesRef = useRef<Message[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Reset to a fresh chat when the user navigates back to "/" (e.g. via the
  // sidebar "new chat" Link).  window.history.replaceState is used earlier to
  // update the URL to /c/chatId without unmounting the component; usePathname()
  // reflects that change, so when Next.js Link navigates to "/" the pathname
  // switches from /c/… back to / and this effect fires.
  const prevPathnameRef = useRef(pathname);
  useEffect(() => {
    if (prevPathnameRef.current !== pathname && pathname === '/' && !id) {
      setMessages([]);
      setChatHistory([]);
      setFiles([]);
      setFileIds([]);
      setPendingImages([]);
      setNewChatCreated(true);
      setIsMessagesLoaded(true);
      setLoading(false);
      setGatheringSources([]);
      setTodoItems([]);
      setAnalysisProgress(null);
      setLiveModelStats(null);
      setNotFound(false);
      setChatId(crypto.randomBytes(20).toString('hex'));
      document.title = 'Chat - YAAWC';
    }
    prevPathnameRef.current = pathname;
  }, [pathname, id]);

  useEffect(() => {
    if (isMessagesLoaded && isConfigReady) {
      setIsReady(true);
      console.debug(new Date(), 'app:ready');
    } else {
      setIsReady(false);
    }
  }, [isMessagesLoaded, isConfigReady]);

  // --- useStream integration ---
  // payloadRef holds the full request body for the next submit() call.
  // The FetchStreamTransport.onRequest callback reads from it.
  const payloadRef = useRef<Record<string, unknown> | null>(null);

  // Track sources and pending message metadata per-stream
  const streamSourcesRef = useRef<Document[]>([]);
  const streamSearchQueryRef = useRef<string | undefined>(undefined);
  const streamActiveRef = useRef(false);
  // Stable assistant messageId for the current stream (so multiple AI messages
  // from tool-calling rounds all update the same app-level Message entry)
  const streamAssistantIdRef = useRef<string>('');
  // Track the human message for chatHistory update in onFinish
  const pendingHumanRef = useRef<{
    message: string;
    imageIds?: string[];
  } | null>(null);
  // Track stream start time for responseTime calculation
  const streamStartTimeRef = useRef<number>(0);

  const transport = useMemo(
    () =>
      new FetchStreamTransport({
        apiUrl: '/api/chat',
        onRequest: async (_url, init) => {
          // Replace the default useStream body with our app's payload
          if (payloadRef.current) {
            return { ...init, body: JSON.stringify(payloadRef.current) };
          }
          return init;
        },
      }),
    [],
  );

  // Helper to process sources from either custom events or update events
  const processSources = useCallback(
    (rawSources: Array<Record<string, unknown>>, searchQuery?: string) => {
      const docSources = rawSources.map((s) => {
        if (s.metadata) return s as unknown as Document;
        return new Document({
          pageContent: '',
          metadata: {
            url: (s.url as string) || '',
            title: (s.title as string) || '',
            ...(s.sourceId !== undefined ? { sourceId: s.sourceId } : {}),
            ...(s.rank !== undefined ? { rank: s.rank } : {}),
          },
        });
      });
      // Deduplicate by URL
      const existingUrls = new Set(
        streamSourcesRef.current.map((d) => d.metadata?.url),
      );
      const newSources = docSources.filter(
        (d) => !existingUrls.has(d.metadata?.url),
      );
      streamSourcesRef.current = [
        ...streamSourcesRef.current,
        ...newSources,
      ];
      streamSearchQueryRef.current =
        searchQuery || streamSearchQueryRef.current;

      if (searchQuery && newSources.length > 0) {
        setGatheringSources((prev) => {
          const existingIndex = prev.findIndex(
            (group) => group.searchQuery === searchQuery,
          );
          if (existingIndex >= 0) {
            const updated = [...prev];
            updated[existingIndex] = {
              searchQuery: searchQuery,
              sources: [...updated[existingIndex].sources, ...newSources],
            };
            return updated;
          }
          return [...prev, { searchQuery: searchQuery, sources: newSources }];
        });
      }
    },
    [],
  );

  const stream = useStream({
    transport,
    onCustomEvent: (data: unknown) => {
      // Handle custom events dispatched by tools (e.g., sources)
      const e = data as {
        sources?: Array<Record<string, unknown>>;
        searchQuery?: string;
        searchUrl?: string;
      };
      if (e?.sources && Array.isArray(e.sources)) {
        processSources(e.sources, e.searchQuery);
      }
    },
    onUpdateEvent: (data: unknown) => {
      // Extract sources and todos from update events
      // When agent.stream() with encoding: 'text/event-stream' is used,
      // dispatchCustomEvent doesn't produce SSE custom events. Instead,
      // we parse tool results from the updates stream.
      const update = data as Record<
        string,
        { messages?: Array<Record<string, unknown>>; todos?: Array<{ content: string; status: string }> }
      >;
      if (!update || typeof update !== 'object') return;

      // Extract todos from any node update (todoListMiddleware uses Command)
      for (const nodeData of Object.values(update)) {
        if (nodeData?.todos && Array.isArray(nodeData.todos)) {
          setTodoItems(nodeData.todos);
        }
      }
      const toolsUpdate = update.tools;
      if (!toolsUpdate?.messages) return;

      for (const msg of toolsUpdate.messages) {
        if (msg.type !== 'tool' || typeof msg.content !== 'string') continue;
        const toolName = msg.name as string;
        // Only extract sources from search/summarization tools
        if (
          !['web_search', 'url_summarization', 'file_search'].includes(toolName)
        )
          continue;

        const content = msg.content as string;
        // Parse [N] Title\nURL: https://... format from tool output
        const sourceRegex =
          /\[(\d+)\]\s+(.+?)\nURL:\s+(https?:\/\/[^\s\n]+)/g;
        let match;
        const parsedSources: Document[] = [];
        while ((match = sourceRegex.exec(content)) !== null) {
          parsedSources.push(
            new Document({
              pageContent: '',
              metadata: {
                sourceId: parseInt(match[1]),
                title: match[2].trim(),
                url: match[3].trim(),
              },
            }),
          );
        }
        if (parsedSources.length > 0) {
          // Determine search query from the tool call args if available
          const toolCallId = msg.tool_call_id as string | undefined;
          // Try to find the corresponding tool call in stream messages
          let searchQuery: string | undefined;
          if (stream.messages) {
            for (const m of stream.messages) {
              if (m.type === 'ai' && 'tool_calls' in m) {
                const aiMsg = m as LangGraphAIMessage;
                const tc = aiMsg.tool_calls?.find(
                  (c: { id?: string }) => c.id === toolCallId,
                );
                if (tc?.args && typeof tc.args === 'object') {
                  searchQuery = (tc.args as Record<string, unknown>)
                    .query as string;
                }
              }
            }
          }
          processSources(
            parsedSources.map((d) => d.metadata as Record<string, unknown>),
            searchQuery,
          );
        }
      }
    },
    onError: (error: unknown) => {
      const errMsg =
        error instanceof Error
          ? `${error.message}\n${error.stack}`
          : String(error);
      console.error('Stream error:', errMsg);
      toast.error(error instanceof Error ? error.message : String(error));
      streamActiveRef.current = false;
      setLoading(false);
    },
  });

  // Watch stream.isLoading to detect when stream finishes
  const wasLoadingRef = useRef(false);
  useEffect(() => {
    if (wasLoadingRef.current && !stream.isLoading && streamActiveRef.current) {
      // Stream just finished
      streamActiveRef.current = false;
      setLoading(false);
      setGatheringSources([]);
      setAnalysisProgress(null);
      setTodoItems([]);
      setScrollTrigger((prev) => prev + 1);

      // Compute final model stats from stream messages
      const aiMsgs = (stream.messages || []).filter(
        (m: LangGraphMessage) => m.type === 'ai',
      ) as LangGraphAIMessage[];
      let totalIn = 0;
      let totalOut = 0;
      for (const aim of aiMsgs) {
        const u = aim.usage_metadata;
        if (u) {
          totalIn += u.input_tokens || 0;
          totalOut += u.output_tokens || 0;
        }
      }
      const elapsed = Date.now() - streamStartTimeRef.current;
      const finalModelStats: ModelStats | undefined =
        totalIn > 0 || totalOut > 0
          ? {
              modelName: '',
              responseTime: elapsed,
              usage: {
                input_tokens: totalIn,
                output_tokens: totalOut,
                total_tokens: totalIn + totalOut,
              },
            }
          : {
              modelName: '',
              responseTime: elapsed,
            };

      // Stamp final modelStats onto the assistant message
      const stableId = streamAssistantIdRef.current;
      if (stableId && finalModelStats) {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.messageId === stableId
              ? { ...msg, modelStats: finalModelStats }
              : msg,
          ),
        );
      }
      setLiveModelStats(null);

      // Update chat history with the completed exchange
      const pending = pendingHumanRef.current;
      if (pending) {
        const lastAssistant = [...messagesRef.current]
          .reverse()
          .find((m) => m.role === 'assistant');
        const assistantContent = lastAssistant?.content || '';
        setChatHistory((prevHistory) => [
          ...prevHistory,
          pending.imageIds?.length
            ? (['human', pending.message, pending.imageIds] as [
                string,
                string,
                string[],
              ])
            : (['human', pending.message] as [string, string]),
          ['assistant', assistantContent],
        ]);
        pendingHumanRef.current = null;
      }

      // Fetch suggestions if appropriate
      const lastMsg = messagesRef.current[messagesRef.current.length - 1];
      if (
        lastMsg?.role === 'assistant' &&
        lastMsg.sources &&
        lastMsg.sources.length > 0 &&
        !lastMsg.suggestions
      ) {
        const autoSuggestions = localStorage.getItem('autoSuggestions');
        if (autoSuggestions !== 'false') {
          getSuggestions(messagesRef.current).then((suggestions) => {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.messageId === lastMsg.messageId
                  ? { ...msg, suggestions }
                  : msg,
              ),
            );
          });
        }
      }
    }
    wasLoadingRef.current = stream.isLoading;
  }, [stream.isLoading]);

  // Todo extraction is handled via onUpdateEvent callback (no 'values' streamMode needed)

  // Cancel handler — calls stream.stop() to abort the SSE transport
  const handleCancel = useCallback(() => {
    stream.stop();
    streamActiveRef.current = false;
    setLoading(false);
  }, [stream]);

  // Derive app messages from useStream messages when streaming is active.
  // Uses setTimeout(0) to batch rapid SSE events into a single state update
  // per macrotask, preventing "Maximum update depth exceeded" when many
  // stream messages arrive faster than React can process them.
  const prevStreamContentRef = useRef('');
  const streamUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  // Keep a ref to the latest stream.messages so the deferred callback
  // always processes the most recent data.
  const latestStreamMsgsRef = useRef(stream.messages);
  latestStreamMsgsRef.current = stream.messages;

  useEffect(() => {
    if (!streamActiveRef.current) return;
    if (!stream.messages || stream.messages.length === 0) return;

    // Cancel any pending update — only the latest one will run
    if (streamUpdateTimerRef.current !== null) {
      clearTimeout(streamUpdateTimerRef.current);
    }

    streamUpdateTimerRef.current = setTimeout(() => {
      streamUpdateTimerRef.current = null;
      const msgs = latestStreamMsgsRef.current;
      if (!msgs || msgs.length === 0) return;

      // Find the last AI message in the stream
      const aiMessages = msgs.filter(
        (m: LangGraphMessage) => m.type === 'ai',
      ) as LangGraphAIMessage[];

      if (aiMessages.length === 0) return;

      // Collect tool messages for status lookup
      const toolMessages = msgs.filter(
        (m: LangGraphMessage) => m.type === 'tool',
      ) as LangGraphToolMessage[];
      const toolResultIds = new Set(toolMessages.map((tm) => tm.tool_call_id));

      // Helper to extract text from an AI message
      const extractText = (msg: LangGraphAIMessage): string => {
        if (typeof msg.content === 'string') return msg.content;
        if (Array.isArray(msg.content)) {
          return msg.content
            .filter(
              (block) =>
                typeof block === 'object' &&
                block !== null &&
                'text' in block,
            )
            .map((block) => (block as { text: string }).text)
            .join('');
        }
        return '';
      };

      // Build content by interleaving text and ToolCall markup per AI message
      // in natural order: thinking text first, then tool calls for each message.
      // This preserves the chronological "reasoning → action" flow.
      // Internal tools like write_todos are excluded from markup since they
      // are shown via the TodoWidget instead.
      const HIDDEN_TOOLS = new Set(['write_todos']);
      const parts: string[] = [];
      for (const aim of aiMessages) {
        const text = extractText(aim);
        if (text) parts.push(text);
        if (aim.tool_calls && aim.tool_calls.length > 0) {
          for (const tc of aim.tool_calls) {
            if (HIDDEN_TOOLS.has(tc.name || '')) continue;
            const status = toolResultIds.has(tc.id ?? '')
              ? 'success'
              : 'running';
            const toolType = tc.name || 'unknown';
            const toolCallId = tc.id || '';
            const query = tc.args?.query as string | undefined;
            const url = tc.args?.url as string | undefined;
            let attrs = `type="${escapeAttribute(toolType)}" status="${status}" toolCallId="${escapeAttribute(toolCallId)}"`;
            if (query) attrs += ` query="${escapeAttribute(query)}"`;
            if (url) attrs += ` url="${escapeAttribute(url)}"`;
            parts.push(`<ToolCall ${attrs}></ToolCall>`);
          }
        }
      }
      const content = parts.join('\n');

      // Guard against redundant updates
      if (content === prevStreamContentRef.current) return;
      prevStreamContentRef.current = content;

      // Aggregate usage_metadata from all AI messages for live model stats
      let totalInput = 0;
      let totalOutput = 0;
      for (const aim of aiMessages) {
        const usage = aim.usage_metadata;
        if (usage) {
          totalInput += usage.input_tokens || 0;
          totalOutput += usage.output_tokens || 0;
        }
      }
      if (totalInput > 0 || totalOutput > 0) {
        const elapsed = Date.now() - streamStartTimeRef.current;
        setLiveModelStats({
          modelName: '',
          responseTime: elapsed,
          usage: {
            input_tokens: totalInput,
            output_tokens: totalOutput,
            total_tokens: totalInput + totalOutput,
          },
        });
      }

      // Update the assistant message in app state
      setMessages((prev) => {
        const stableId = streamAssistantIdRef.current;
        const currentAssistantIdx = prev.findIndex(
          (m) => m.role === 'assistant' && m.messageId === stableId,
        );

        const assistantMsg: Message = {
          messageId: stableId,
          chatId: chatId!,
          role: 'assistant',
          content,
          createdAt: new Date(),
          sources:
            streamSourcesRef.current.length > 0
              ? streamSourcesRef.current
              : undefined,
          searchQuery: streamSearchQueryRef.current,
        };

        if (currentAssistantIdx >= 0) {
          const updated = [...prev];
          updated[currentAssistantIdx] = {
            ...updated[currentAssistantIdx],
            ...assistantMsg,
          };
          return updated;
        } else {
          return [...prev, assistantMsg];
        }
      });

      setScrollTrigger((prev) => prev + 1);
    }, 0);

    return () => {
      if (streamUpdateTimerRef.current !== null) {
        clearTimeout(streamUpdateTimerRef.current);
        streamUpdateTimerRef.current = null;
      }
    };
  }, [stream.messages, chatId]);

  const sendMessage = async (
    message: string,
    options?: {
      messageId?: string;
      suggestions?: string[];
      editMode?: boolean;
      images?: ImageAttachment[];
    },
  ) => {
    const userLocation = sendLocation ? personalizationLocation : '';
    const userProfile = sendPersonalization ? personalizationAbout : '';

    setScrollTrigger((x) => (x === 0 ? -1 : 0));
    // Special case: If we're just updating an existing message with suggestions
    if (options?.suggestions && options.messageId) {
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.messageId === options.messageId) {
            return { ...msg, suggestions: options.suggestions };
          }
          return msg;
        }),
      );
      return;
    }

    if (loading) return;
    if (!isConfigReady) {
      toast.error('Cannot send message before the configuration is ready');
      return;
    }

    setLoading(true);
    setGatheringSources([]); // Reset gathering sources for new conversation
    setLiveModelStats(null);
    setAnalysisProgress(null);

    let messageChatHistory = chatHistory;

    // If the user is editing or rewriting a message, we need to remove the messages after it
    const rewriteIndex = messages.findIndex(
      (msg) => msg.messageId === options?.messageId,
    );
    if (rewriteIndex !== -1) {
      setMessages((prev) => {
        return [...prev.slice(0, rewriteIndex)];
      });

      messageChatHistory = chatHistory.slice(0, rewriteIndex);
      setChatHistory(messageChatHistory);

      setScrollTrigger((prev) => prev + 1);
    }

    const messageId =
      options?.messageId ?? crypto.randomBytes(7).toString('hex');

    // In edit mode, use explicitly-provided images; otherwise use pendingImages
    const messageImages =
      options?.images !== undefined
        ? options.images.length > 0
          ? options.images
          : undefined
        : pendingImages.length > 0
          ? [...pendingImages]
          : undefined;
    const messageImageIds = messageImages?.map((img) => img.imageId);

    setMessages((prevMessages) => [
      ...prevMessages,
      {
        content: message,
        messageId: messageId,
        chatId: chatId!,
        role: 'user',
        createdAt: new Date(),
        ...(messageImages && { images: messageImages }),
      },
    ]);

    setPendingImages([]);

    // If this is a new chat (no chatId in URL), replace the URL to include the new chatId
    if (messages.length <= 1) {
      window.history.replaceState({}, '', `/c/${chatId}`);
    }

    const ollamaContextWindow =
      localStorage.getItem('ollamaContextWindow') || '2048';

    const currentChatModelProvider = localStorage.getItem('chatModelProvider');
    const currentChatModel = localStorage.getItem('chatModel');

    const modelProvider =
      currentChatModelProvider || chatModelProvider.provider;
    const modelName = currentChatModel || chatModelProvider.name;

    const systemModelProvider =
      localStorage.getItem('systemModelProvider') || modelProvider;
    const systemModelName = localStorage.getItem('systemModel') || modelName;

    // Reset stream refs for new request
    streamSourcesRef.current = [];
    streamSearchQueryRef.current = undefined;
    streamActiveRef.current = true;
    streamAssistantIdRef.current = crypto.randomBytes(7).toString('hex');
    streamStartTimeRef.current = Date.now();
    prevStreamContentRef.current = '';

    // Store the payload for the FetchStreamTransport onRequest callback
    const payload: Record<string, unknown> = {
      message: {
        messageId: messageId,
        chatId: chatId!,
        content: message,
      },
      focusMode: focusMode,
      history: messageChatHistory,
      files: fileIds,
      chatModel: {
        name: modelName,
        provider: modelProvider,
        ...(chatModelProvider.provider === 'ollama' && {
          ollamaContextWindow: parseInt(ollamaContextWindow),
        }),
      },
      systemModel: {
        name: systemModelName,
        provider: systemModelProvider,
        ...(systemModelProvider === 'ollama' && {
          ollamaContextWindow: parseInt(ollamaContextWindow),
        }),
      },
      embeddingModel: {
        name: embeddingModelProvider.name,
        provider: embeddingModelProvider.provider,
      },
      selectedSystemPromptIds: systemPromptIds || [],
    };

    if (messageImageIds?.length) {
      payload.messageImageIds = messageImageIds;
      payload.messageImages = messageImages;
    }

    if (userLocation) {
      payload.userLocation = userLocation;
    }
    if (userProfile) {
      payload.userProfile = userProfile;
    }

    payloadRef.current = payload;
    pendingHumanRef.current = {
      message,
      imageIds: messageImageIds,
    };

    // Submit via useStream transport - this triggers the SSE stream
    try {
      await stream.submit(null);
    } catch (err) {
      console.error('Stream submit error:', err);
      toast.error('Failed to send message');
      setLoading(false);
      streamActiveRef.current = false;
      pendingHumanRef.current = null;
    }
  };

  const rewrite = (messageId: string) => {
    const messageIndex = messages.findIndex(
      (msg) => msg.messageId === messageId,
    );
    if (messageIndex == -1) return;
    sendMessage(messages[messageIndex - 1].content, {
      messageId: messages[messageIndex - 1].messageId,
    });
  };

  const handleEditMessage = async (
    messageId: string,
    newContent: string,
    images?: ImageAttachment[],
  ) => {
    // Get the index of the message being edited
    const messageIndex = messages.findIndex(
      (msg) => msg.messageId === messageId,
    );
    if (messageIndex === -1) return;

    try {
      sendMessage(newContent, {
        messageId,
        editMode: true,
        images,
      });
    } catch (error) {
      console.error('Error updating message:', error);
      toast.error('Failed to update message');
    }
  };

  const handleThinkBoxToggle = (
    messageId: string,
    thinkBoxId: string,
    expanded: boolean,
  ) => {
    setMessages((prev) =>
      prev.map((message) => {
        if (message.messageId === messageId) {
          const expandedThinkBoxes = new Set(message.expandedThinkBoxes || []);
          if (expanded) {
            expandedThinkBoxes.add(thinkBoxId);
          } else {
            expandedThinkBoxes.delete(thinkBoxId);
          }
          return { ...message, expandedThinkBoxes };
        }
        return message;
      }),
    );
  };

  useEffect(() => {
    if (isReady && initialMessage && isConfigReady) {
      // Check if we have an initial query and apply saved search settings
      const searchChatModelProvider = localStorage.getItem(
        'searchChatModelProvider',
      );
      const searchChatModel = localStorage.getItem('searchChatModel');

      // Apply saved chat model if valid
      if (searchChatModelProvider && searchChatModel) {
        setChatModelProvider({
          name: searchChatModel,
          provider: searchChatModelProvider,
        });
        // Also update localStorage to ensure consistency
        localStorage.setItem('chatModelProvider', searchChatModelProvider);
        localStorage.setItem('chatModel', searchChatModel);
      }

      sendMessage(initialMessage);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfigReady, isReady, initialMessage]);

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

  return isReady ? (
    notFound ? (
      <NextError statusCode={404} />
    ) : (
      <div>
        {messages.length > 0 ? (
          <>
            <Navbar chatId={chatId!} messages={messages} />
            <Chat
              loading={loading}
              messages={messages}
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
              analysisProgress={analysisProgress}
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
              onCancel={handleCancel}
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
    )
  ) : (
    <div className="flex flex-row items-center justify-center min-h-screen">
      <svg
        aria-hidden="true"
        className="w-8 h-8 text-fg/20 fill-fg/30 animate-spin"
        viewBox="0 0 100 101"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M100 50.5908C100.003 78.2051 78.1951 100.003 50.5908 100C22.9765 99.9972 0.997224 78.018 1 50.4037C1.00281 22.7993 22.8108 0.997224 50.4251 1C78.0395 1.00281 100.018 22.8108 100 50.4251ZM9.08164 50.594C9.06312 73.3997 27.7909 92.1272 50.5966 92.1457C73.4023 92.1642 92.1298 73.4365 92.1483 50.6308C92.1669 27.8251 73.4392 9.0973 50.6335 9.07878C27.8278 9.06026 9.10003 27.787 9.08164 50.594Z"
          fill="currentColor"
        />
        <path
          d="M93.9676 39.0409C96.393 38.4037 97.8624 35.9116 96.9801 33.5533C95.1945 28.8227 92.871 24.3692 90.0681 20.348C85.6237 14.1775 79.4473 9.36872 72.0454 6.45794C64.6435 3.54717 56.3134 2.65431 48.3133 3.89319C45.869 4.27179 44.3768 6.77534 45.014 9.20079C45.6512 11.6262 48.1343 13.0956 50.5786 12.717C56.5073 11.8281 62.5542 12.5399 68.0406 14.7911C73.527 17.0422 78.2187 20.7487 81.5841 25.4923C83.7976 28.5886 85.4467 32.059 86.4416 35.7474C87.1273 38.1189 89.5423 39.6781 91.9676 39.0409Z"
          fill="currentFill"
        />
      </svg>
    </div>
  );
};

export default ChatWindow;
