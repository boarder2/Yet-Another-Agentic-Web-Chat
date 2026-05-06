'use client';

import { useEffect, useRef, useState } from 'react';
import { updateToolCallMarkup } from '@/lib/utils/toolCallMarkup';
import { encodeHtmlAttribute } from '@/lib/utils/html';
import { Document } from '@langchain/core/documents';
import ChatActions from './ChatActions';
import Chat from './Chat';
import { PendingExecution } from './CodeExecution';
import { PendingQuestion } from './UserQuestionPrompt';
import { PendingEditApproval } from './WorkspaceEditApproval';
import EmptyChat from './EmptyChat';
import crypto from 'crypto';
import { toast } from 'sonner';
import { notifyWorkspaceUpdated } from '@/lib/hooks/useWorkspace';
import { useSearchParams, usePathname } from 'next/navigation';
import { getSuggestions } from '@/lib/actions';
import { LoaderCircle, Settings } from 'lucide-react';
import Link from 'next/link';
import NextError from 'next/error';
import {
  useLocalStorageBoolean,
  useLocalStorageString,
} from '@/lib/hooks/useLocalStorage';

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
  memoriesUsed?: number;
  firstChatCallInputTokens?: number;
};

export type CompactionData = {
  summary: string;
  compactedMessageCount: number;
  tokensBefore: number;
  tokensAfter: number;
  compactedAt: string;
};

export type Message = {
  messageId: string;
  chatId: string;
  createdAt: Date;
  content: string;
  role: 'user' | 'assistant' | 'compaction';
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
  compaction?: CompactionData;
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

    const [providers, serverConfig] = await Promise.all([
      fetch(`/api/models`, {
        headers: { 'Content-Type': 'application/json' },
      }).then(async (res) => {
        if (!res.ok)
          throw new Error(
            `Failed to fetch models: ${res.status} ${res.statusText}`,
          );
        return res.json();
      }),
      // Fetch server config for saved model preferences
      !chatModel ||
      !chatModelProvider ||
      !embeddingModel ||
      !embeddingModelProvider
        ? fetch('/api/config')
            .then((r) => (r.ok ? r.json() : null))
            .catch(() => null)
        : Promise.resolve(null),
    ]);

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
        }

        // Try server config first, then fall back to first available provider
        const serverChatProvider = serverConfig?.selectedSystemModelProvider;
        if (
          serverChatProvider &&
          chatModelProviders[serverChatProvider] &&
          Object.keys(chatModelProviders[serverChatProvider]).length > 0
        ) {
          chatModelProvider = serverChatProvider;
          const serverModel = serverConfig.selectedSystemModel;
          if (
            serverModel &&
            chatModelProviders[serverChatProvider][serverModel]
          ) {
            chatModel = serverModel;
          } else {
            chatModel = Object.keys(chatModelProviders[serverChatProvider])[0];
          }
        } else {
          chatModelProvider =
            chatModelProvidersKeys.find(
              (provider) =>
                Object.keys(chatModelProviders[provider]).length > 0,
            ) || chatModelProvidersKeys[0];

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
      }

      if (!embeddingModel || !embeddingModelProvider) {
        const embeddingModelProviders = providers.embeddingModelProviders;

        if (
          !embeddingModelProviders ||
          Object.keys(embeddingModelProviders).length === 0
        )
          return toast.error('No embedding models available');

        // Try server config first
        const serverEmbProvider = serverConfig?.selectedEmbeddingModelProvider;
        if (serverEmbProvider && embeddingModelProviders[serverEmbProvider]) {
          embeddingModelProvider = serverEmbProvider;
          const serverModel = serverConfig.selectedEmbeddingModel;
          if (
            serverModel &&
            embeddingModelProviders[serverEmbProvider][serverModel]
          ) {
            embeddingModel = serverModel;
          } else {
            embeddingModel = Object.keys(
              embeddingModelProviders[serverEmbProvider],
            )[0];
          }
        } else {
          embeddingModelProvider = Object.keys(embeddingModelProviders)[0];
          embeddingModel = Object.keys(
            embeddingModelProviders[embeddingModelProvider],
          )[0];
        }
      }

      localStorage.setItem('chatModel', chatModel!);
      localStorage.setItem('chatModelProvider', chatModelProvider!);
      localStorage.setItem('embeddingModel', embeddingModel!);
      localStorage.setItem('embeddingModelProvider', embeddingModelProvider!);
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
      provider: chatModelProvider!,
    });

    setEmbeddingModelProvider({
      name: embeddingModel!,
      provider: embeddingModelProvider!,
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
  setFocusMode: (mode: string) => void,
  setNotFound: (notFound: boolean) => void,
  setFiles: (files: File[]) => void,
  setFileIds: (fileIds: string[]) => void,
  setIsPrivateSession?: (isPrivate: boolean) => void,
  setPinned?: (pinned: boolean) => void,
  setSelectedWorkspaceId?: (id: string | null) => void,
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
    return {
      ...(msg as Record<string, unknown>),
      ...JSON.parse((msg as Record<string, string>).metadata),
    };
  }) as Message[];

  // Each compaction is stored as a 'compaction' role row in the DB with metadata
  // containing compactedUpTo (the integer id of the last compacted message).
  // Position each marker right after its compactedUpTo message in the list.
  type RawMsg = Message & {
    id?: number;
    compactedUpTo?: number;
    positionId?: number;
    compactedMessageCount?: number;
    tokensBefore?: number;
    tokensAfter?: number;
    compactedAt?: string;
  };
  const rawMessages = messages as RawMsg[];

  const compactionByPosition = new Map<number, Message[]>();
  for (const row of rawMessages) {
    if (row.role !== 'compaction') continue;
    // Use positionId if available (last message at compact time), otherwise
    // fall back to compactedUpTo (last compacted message id).
    const pos = row.positionId ?? row.compactedUpTo ?? -1;
    const marker: Message = {
      messageId: row.messageId,
      chatId,
      createdAt: new Date(row.compactedAt || Date.now()),
      content: row.content,
      role: 'compaction',
      compaction: {
        summary: row.content,
        compactedMessageCount: row.compactedMessageCount || 0,
        tokensBefore: row.tokensBefore || 0,
        tokensAfter: row.tokensAfter || 0,
        compactedAt: row.compactedAt || '',
      },
    };
    const existing = compactionByPosition.get(pos) ?? [];
    existing.push(marker);
    compactionByPosition.set(pos, existing);
  }

  const finalMessages: Message[] = [];
  for (const msg of rawMessages) {
    if (msg.role === 'compaction') continue;
    finalMessages.push(msg as Message);
    const markersHere = compactionByPosition.get(msg.id ?? -1) ?? [];
    finalMessages.push(...markersHere);
  }

  setMessages(finalMessages);

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

  setFocusMode(data.chat.focusMode);
  if (setIsPrivateSession) {
    setIsPrivateSession(data.chat.isPrivate === 1);
  }
  if (setPinned) {
    setPinned(data.chat.pinned === 1);
  }
  if (setSelectedWorkspaceId) {
    setSelectedWorkspaceId(data.chat.workspaceId ?? null);
  }
  setIsMessagesLoaded(true);
};

const ChatWindow = ({
  id,
  workspaceId,
}: {
  id?: string;
  workspaceId?: string;
}) => {
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

  const [messages, setMessages] = useState<Message[]>([]);
  const [compacting, setCompacting] = useState(false);

  const [todoItems, setTodoItems] = useState<
    Array<{ content: string; status: string }>
  >([]);

  const [pendingExecutions, setPendingExecutions] = useState<
    Record<string, PendingExecution[]>
  >({});

  const [pendingQuestions, setPendingQuestions] = useState<
    Record<string, PendingQuestion[]>
  >({});

  const [pendingEditApprovals, setPendingEditApprovals] = useState<
    Record<string, PendingEditApproval[]>
  >({});

  const [files, setFiles] = useState<File[]>([]);
  const [fileIds, setFileIds] = useState<string[]>([]);

  const [pendingImages, setPendingImages] = useState<ImageAttachment[]>([]);

  const [imageCapable] = useLocalStorageBoolean('imageCapable', false);

  const [focusMode, setFocusMode] = useState('webSearch');
  const [systemPromptIds, setSystemPromptIds] = useState<string[]>([]);
  const [selectedMethodologyId, setSelectedMethodologyId] = useState<
    string | null
  >(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(
    () => workspaceId ?? searchParams.get('workspace'),
  );

  const [isMessagesLoaded, setIsMessagesLoaded] = useState(false);

  const [notFound, setNotFound] = useState(false);

  const [isPrivateSession, setIsPrivateSession] = useState(
    () => searchParams.get('private') === '1',
  );

  const [pinned, setPinned] = useState(false);

  // Default to all-false so capability-gated UI stays hidden until the
  // config response arrives. Showing and then hiding would flash.
  const [searchCapabilitiesRegular, setSearchCapabilitiesRegular] = useState<{
    web: boolean;
    images: boolean;
    videos: boolean;
    autocomplete: boolean;
  }>({ web: false, images: false, videos: false, autocomplete: false });
  const [searchCapabilitiesPrivate, setSearchCapabilitiesPrivate] = useState<{
    web: boolean;
    images: boolean;
    videos: boolean;
    autocomplete: boolean;
  }>({ web: false, images: false, videos: false, autocomplete: false });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/config')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        if (data.searchCapabilitiesRegular) {
          setSearchCapabilitiesRegular(data.searchCapabilitiesRegular);
        }
        if (data.searchCapabilitiesPrivate) {
          setSearchCapabilitiesPrivate(data.searchCapabilitiesPrivate);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // State for tracking sources during gathering phase
  const [gatheringSources, setGatheringSources] = useState<
    Array<{
      searchQuery: string;
      sources: Document[];
    }>
  >([]);

  const [sendLocation, setSendLocation] = useLocalStorageBoolean(
    SEND_LOCATION_KEY,
    false,
  );
  const [sendPersonalization, setSendPersonalization] = useLocalStorageBoolean(
    SEND_PROFILE_KEY,
    false,
  );
  const [personalizationLocation] = useLocalStorageString(
    'personalization.location',
    '',
  );
  const [personalizationAbout] = useLocalStorageString(
    'personalization.about',
    '',
  );

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
        setFocusMode,
        setNotFound,
        setFiles,
        setFileIds,
        setIsPrivateSession,
        setPinned,
        setSelectedWorkspaceId,
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

  // When the user navigates to /?private=1 from /, the pathname doesn't change
  // so the pathname effect below won't fire. Watch searchParams directly and
  // reset + activate private mode when the private param appears or disappears.
  const prevSearchParamsRef = useRef(searchParams);
  useEffect(() => {
    if (prevSearchParamsRef.current === searchParams) return;
    prevSearchParamsRef.current = searchParams;

    // Only act when we're on a new-chat page (root or workspace), not an existing chat
    if (id || (pathname !== '/' && !workspaceId)) return;

    // Skip when a message is in flight — replaceState drops ?private=1 from
    // the URL when the chat URL is created, which would otherwise cause a
    // spurious reset that clears the messages being streamed.
    if (loading) return;

    const isPriv = searchParams.get('private') === '1';
    setMessages([]);
    setFiles([]);
    setFileIds([]);
    setPendingImages([]);
    setNewChatCreated(true);
    setIsMessagesLoaded(true);
    setLoading(false);
    setGatheringSources([]);
    setTodoItems([]);
    setPendingExecutions({});
    setPendingQuestions({});
    setAnalysisProgress(null);
    setLiveModelStats(null);
    setNotFound(false);
    setIsPrivateSession(isPriv);
    setChatId(crypto.randomBytes(20).toString('hex'));
    document.title = 'Chat - YAAWC';
  }, [searchParams, pathname, id, workspaceId, loading]);

  // Reset to a fresh chat when the user navigates back to "/" (e.g. via the
  // sidebar "new chat" Link).  window.history.replaceState is used earlier to
  // update the URL to /c/chatId without unmounting the component; usePathname()
  // reflects that change, so when Next.js Link navigates to "/" the pathname
  // switches from /c/… back to / and this effect fires.
  const prevPathnameRef = useRef(pathname);
  useEffect(() => {
    if (prevPathnameRef.current !== pathname && pathname === '/' && !id) {
      setMessages([]);
      setFiles([]);
      setFileIds([]);
      setPendingImages([]);
      setNewChatCreated(true);
      setIsMessagesLoaded(true);
      setLoading(false);
      setGatheringSources([]);
      setTodoItems([]);
      setPendingExecutions({});
      setPendingQuestions({});
      setAnalysisProgress(null);
      setLiveModelStats(null);
      setNotFound(false);
      setIsPrivateSession(searchParams.get('private') === '1');
      setChatId(crypto.randomBytes(20).toString('hex'));
      document.title = 'Chat - YAAWC';
    }
    prevPathnameRef.current = pathname;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, id]);

  useEffect(() => {
    if (isMessagesLoaded && isConfigReady) {
      setIsReady(true);
      console.debug(new Date(), 'app:ready');
    } else {
      setIsReady(false);
    }
  }, [isMessagesLoaded, isConfigReady]);

  const sendMessage = async (
    message: string,
    options?: {
      messageId?: string;
      suggestions?: string[];
      editMode?: boolean;
      images?: ImageAttachment[];
    },
  ) => {
    const userLocation =
      !isPrivateSession && sendLocation ? personalizationLocation : '';
    const userProfile =
      !isPrivateSession && sendPersonalization ? personalizationAbout : '';

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

    let sources: Document[] | undefined = undefined;
    let recievedMessage = '';
    // Map executionId → runId for correlating code_execution_result with the correct ToolCall markup
    const codeExecutionRunIdMap = new Map<string, string>();
    // Map questionId → runId for correlating user_question_answered with the correct ToolCall markup
    const userQuestionRunIdMap = new Map<string, string>();
    let messageBuffer = '';
    let tokenCount = 0;
    const bufferThreshold = 5;
    let added = false;

    // If the user is editing or rewriting a message, truncate local UI state.
    // The server handles DB truncation in handleHistorySave (authoritative).
    const rewriteIndex = messages.findIndex(
      (msg) => msg.messageId === options?.messageId,
    );
    if (rewriteIndex !== -1) {
      setMessages((prev) => {
        return [...prev.slice(0, rewriteIndex)];
      });

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
      const newUrl = workspaceId
        ? `/workspaces/${workspaceId}/c/${chatId}`
        : `/c/${chatId}`;
      window.history.replaceState({}, '', newUrl);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messageHandler = async (data: Record<string, any>) => {
      if (data.type === 'error') {
        toast.error(data.data);
        setLoading(false);
        return;
      }

      if (data.type === 'progress') {
        setAnalysisProgress(data.data);
        return;
      }
      if (data.type === 'stats') {
        // live model stats snapshot during run
        setLiveModelStats(data.data);
        return;
      }

      // Handle ping messages to keep connection alive (no action needed)
      if (data.type === 'ping') {
        console.debug('Ping received');
        // Ping messages are used to keep the connection alive during long requests
        // No action is required on the frontend
        return;
      }

      if (data.type === 'sources_added') {
        // Track gathering sources during search phase with search query
        if (data.searchQuery && data.searchQuery.trim()) {
          setGatheringSources((prev) => {
            const existingIndex = prev.findIndex(
              (group) => group.searchQuery === data.searchQuery,
            );
            if (existingIndex >= 0) {
              // Update existing group
              const updated = [...prev];
              updated[existingIndex] = {
                searchQuery: data.searchQuery,
                sources: [...updated[existingIndex].sources, ...data.data],
              };
              return updated;
            } else {
              // Add new group
              return [
                ...prev,
                {
                  searchQuery: data.searchQuery,
                  sources: data.data,
                },
              ];
            }
          });
        }
      }

      if (data.type === 'sources') {
        sources = data.data;

        if (!added) {
          setMessages((prevMessages) => [
            ...prevMessages,
            {
              content: '',
              messageId: data.messageId,
              chatId: chatId!,
              role: 'assistant',
              sources: sources,
              searchQuery: data.searchQuery,
              searchUrl: data.searchUrl,
              createdAt: new Date(),
            },
          ]);
          added = true;
          setScrollTrigger((prev) => prev + 1);
        } else {
          // set the sources
          setMessages((prev) =>
            prev.map((message) => {
              if (message.messageId === data.messageId) {
                return { ...message, sources: sources };
              }
              return message;
            }),
          );
        }
      }

      // (Inline ToolCall status updater removed; using shared updateToolCallMarkup helper.)

      if (data.type === 'tool_call_started') {
        const toolContent = data.data.content; // Already a <ToolCall ... status="running" ...>
        console.log('Tool call started:', toolContent);
        if (!added) {
          setMessages((prevMessages) => [
            ...prevMessages,
            {
              content: toolContent,
              messageId: data.messageId,
              chatId: chatId!,
              role: 'assistant',
              sources: sources,
              createdAt: new Date(),
            },
          ]);
          added = true;
        } else {
          setMessages((prev) =>
            prev.map((message) =>
              message.messageId === data.messageId
                ? { ...message, content: message.content + toolContent }
                : message,
            ),
          );
        }
        recievedMessage += toolContent;
        setScrollTrigger((prev) => prev + 1);
        return;
      }

      if (
        data.type === 'tool_call_success' ||
        data.type === 'tool_call_error'
      ) {
        console.log('Tool call ended:', data);
        const { toolCallId, status, extra } = data.data;
        const errorMsg =
          data.type === 'tool_call_error' ? data.data.error : undefined;
        setMessages((prev) =>
          prev.map((message) => {
            if (message.messageId === data.messageId) {
              const updatedContent = updateToolCallMarkup(
                message.content,
                toolCallId,
                {
                  status,
                  error: errorMsg,
                  extra,
                },
              );
              return { ...message, content: updatedContent };
            }
            return message;
          }),
        );
        recievedMessage = updateToolCallMarkup(recievedMessage, toolCallId, {
          status,
          error: errorMsg,
          extra,
        });
        setScrollTrigger((prev) => prev + 1);
        return;
      }

      // Handle subagent execution started
      if (data.type === 'subagent_started') {
        console.log('ChatWindow: Subagent started:', data);
        const subagentMarkup = `<SubagentExecution id="${data.executionId}" name="${encodeHtmlAttribute(data.name ?? '')}" task="${encodeHtmlAttribute(data.task ?? '')}" status="running"></SubagentExecution>\n`;

        if (!added) {
          setMessages((prevMessages) => [
            ...prevMessages,
            {
              content: subagentMarkup,
              messageId: data.messageId || 'temp',
              chatId: chatId!,
              role: 'assistant',
              sources: sources,
              createdAt: new Date(),
            },
          ]);
          added = true;
        } else {
          setMessages((prev) =>
            prev.map((message) =>
              message.messageId === data.messageId
                ? { ...message, content: message.content + subagentMarkup }
                : message,
            ),
          );
        }
        recievedMessage += subagentMarkup;
        setScrollTrigger((prev) => prev + 1);
        return;
      }

      // Handle subagent data (nested events like tool calls and responses)
      if (data.type === 'subagent_data') {
        const nestedEvent = data.data;
        const executionId = data.subagentId;

        // Handle response tokens - accumulate into responseText attribute
        if (nestedEvent.type === 'response') {
          const token = nestedEvent.data || '';
          console.log('ChatWindow: Subagent response token:', {
            executionId,
            tokenLength: token.length,
            token: token.substring(0, 50),
          });
          setMessages((prev) =>
            prev.map((message) => {
              if (message.messageId === data.messageId) {
                const subagentRegex = new RegExp(
                  `<SubagentExecution\\s+id="${executionId}"([^>]*)>`,
                  'g',
                );

                const updatedContent = message.content.replace(
                  subagentRegex,
                  (match, attrs) => {
                    // Extract existing responseText
                    const responseMatch = attrs.match(/responseText="([^"]*)"/);
                    let existingText = '';
                    if (responseMatch) {
                      existingText = responseMatch[1]
                        .replace(/&quot;/g, '"')
                        .replace(/&lt;/g, '<')
                        .replace(/&gt;/g, '>')
                        .replace(/&amp;/g, '&');
                    }

                    // Append new token
                    const newText = existingText + token;
                    const escapedText = newText
                      .replace(/&/g, '&amp;')
                      .replace(/</g, '&lt;')
                      .replace(/>/g, '&gt;')
                      .replace(/"/g, '&quot;');

                    // Update or add responseText attribute
                    let updatedAttrs = attrs.replace(
                      /responseText="[^"]*"/,
                      `responseText="${escapedText}"`,
                    );
                    if (!updatedAttrs.includes('responseText=')) {
                      updatedAttrs += ` responseText="${escapedText}"`;
                    }

                    console.log('ChatWindow: Updated responseText attr:', {
                      executionId,
                      textLength: newText.length,
                      escapedLength: escapedText.length,
                    });

                    return `<SubagentExecution id="${executionId}"${updatedAttrs}>`;
                  },
                );

                return { ...message, content: updatedContent };
              }
              return message;
            }),
          );
          return;
        }

        // Only process tool call events beyond this point
        if (!nestedEvent.type || !nestedEvent.type.startsWith('tool_call')) {
          return;
        }

        console.log('ChatWindow: Subagent tool call:', nestedEvent);

        // Convert tool call event to ToolCall markup
        let toolCallMarkup = '';
        if (
          nestedEvent.type === 'tool_call_started' &&
          nestedEvent.data?.content
        ) {
          toolCallMarkup = nestedEvent.data.content;
        } else if (
          nestedEvent.type === 'tool_call_success' &&
          nestedEvent.data?.toolCallId
        ) {
          // Success event will update existing ToolCall, handle in next block
          setMessages((prev) =>
            prev.map((message) => {
              if (message.messageId === data.messageId) {
                // Update existing ToolCall status
                const toolCallRegex = new RegExp(
                  `<ToolCall([^>]*toolCallId="${nestedEvent.data.toolCallId}"[^>]*)>`,
                  'g',
                );
                const updatedContent = message.content.replace(
                  toolCallRegex,
                  (match, attrs) => {
                    let updated = attrs.replace(
                      /status="[^"]*"/,
                      'status="success"',
                    );
                    if (!updated.includes('status=')) {
                      updated += ' status="success"';
                    }
                    return `<ToolCall${updated}>`;
                  },
                );
                return { ...message, content: updatedContent };
              }
              return message;
            }),
          );
          return;
        } else if (
          nestedEvent.type === 'tool_call_error' &&
          nestedEvent.data?.toolCallId
        ) {
          // Error event will update existing ToolCall
          setMessages((prev) =>
            prev.map((message) => {
              if (message.messageId === data.messageId) {
                const toolCallRegex = new RegExp(
                  `<ToolCall([^>]*toolCallId="${nestedEvent.data.toolCallId}"[^>]*)>`,
                  'g',
                );
                const updatedContent = message.content.replace(
                  toolCallRegex,
                  (match, attrs) => {
                    let updated = attrs.replace(
                      /status="[^"]*"/,
                      'status="error"',
                    );
                    if (!updated.includes('status=')) {
                      updated += ' status="error"';
                    }
                    if (nestedEvent.data.error) {
                      const escapedError = nestedEvent.data.error
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;')
                        .replace(/"/g, '&quot;');
                      updated += ` error="${escapedError}"`;
                    }
                    return `<ToolCall${updated}>`;
                  },
                );
                return { ...message, content: updatedContent };
              }
              return message;
            }),
          );
          return;
        }

        if (!toolCallMarkup) {
          return;
        }

        // Insert ToolCall markup inside SubagentExecution
        setMessages((prev) =>
          prev.map((message) => {
            if (message.messageId === data.messageId) {
              // Use a more permissive regex that can match existing nested content
              const subagentRegex = new RegExp(
                `(<SubagentExecution\\s+id="${executionId}"[^>]*>)(.*?)(</SubagentExecution>)`,
                'gs',
              );

              const updatedContent = message.content.replace(
                subagentRegex,
                (match, openTag, content, closeTag) => {
                  console.log(
                    'ChatWindow: Inserting ToolCall, existing content length:',
                    content.length,
                  );
                  return `${openTag}${content}${toolCallMarkup}\n${closeTag}`;
                },
              );

              return { ...message, content: updatedContent };
            }
            return message;
          }),
        );

        setScrollTrigger((prev) => prev + 1);
        return;
      }

      // Handle subagent completion or error
      if (
        data.type === 'subagent_completed' ||
        data.type === 'subagent_error'
      ) {
        console.log('ChatWindow: Subagent ended:', data.type, data);
        const status = data.type === 'subagent_completed' ? 'success' : 'error';
        const executionId = data.id;

        setMessages((prev) =>
          prev.map((message) => {
            if (message.messageId === data.messageId) {
              // Find and update the specific SubagentExecution tag
              const subagentRegex = new RegExp(
                `<SubagentExecution\\s+id="${executionId}"([^>]*)>(.*?)<\\/SubagentExecution>`,
                'gs',
              );

              const updatedContent = message.content.replace(
                subagentRegex,
                (match, attrs, innerContent) => {
                  // Update attributes
                  let updatedAttrs = attrs
                    .replace(/status="[^"]*"/, `status="${status}"`)
                    .trim();

                  if (!updatedAttrs.includes('status=')) {
                    updatedAttrs += ` status="${status}"`;
                  }

                  if (data.summary && status === 'success') {
                    // Escape HTML entities in summary
                    const escapedSummary = data.summary
                      .replace(/&/g, '&amp;')
                      .replace(/</g, '&lt;')
                      .replace(/>/g, '&gt;')
                      .replace(/"/g, '&quot;');
                    updatedAttrs += ` summary="${escapedSummary}"`;
                  }

                  if (data.error && status === 'error') {
                    const escapedError = data.error
                      .replace(/&/g, '&amp;')
                      .replace(/</g, '&lt;')
                      .replace(/>/g, '&gt;')
                      .replace(/"/g, '&quot;');
                    updatedAttrs += ` error="${escapedError}"`;
                  }

                  // Preserve inner content (ToolCall markup)
                  return `<SubagentExecution ${updatedAttrs}>${innerContent}</SubagentExecution>`;
                },
              );

              return { ...message, content: updatedContent };
            }
            return message;
          }),
        );

        // Update recievedMessage as well
        const subagentRegexForPersistence = new RegExp(
          `<SubagentExecution\\s+id="${executionId}"([^>]*)>(.*?)<\\/SubagentExecution>`,
          'gs',
        );
        recievedMessage = recievedMessage.replace(
          subagentRegexForPersistence,
          (match, attrs, innerContent) => {
            let updatedAttrs = attrs
              .replace(/status="[^"]*"/, `status="${status}"`)
              .trim();
            if (!updatedAttrs.includes('status=')) {
              updatedAttrs += ` status="${status}"`;
            }
            if (data.summary && status === 'success') {
              const escapedSummary = data.summary
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
              updatedAttrs += ` summary="${escapedSummary}"`;
            }
            if (data.error && status === 'error') {
              const escapedError = data.error
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;');
              updatedAttrs += ` error="${escapedError}"`;
            }
            return `<SubagentExecution ${updatedAttrs}>${innerContent}</SubagentExecution>`;
          },
        );

        setScrollTrigger((prev) => prev + 1);
        return;
      }

      if (data.type === 'code_execution_pending') {
        // Correlate this execution with the ToolCall markup's toolCallId
        // (provided by codeExecutionCorrelation module via markupToolCallId).
        const runId = data.data?.markupToolCallId;
        if (runId && data.data?.executionId) {
          codeExecutionRunIdMap.set(data.data.executionId, runId);
        }
        setPendingExecutions((prev) => ({
          ...prev,
          [data.messageId]: [
            ...(prev[data.messageId] ?? []),
            {
              executionId: data.data.executionId,
              code: data.data.code,
              description: data.data.description,
              toolCallId: data.data.toolCallId,
              status: 'pending' as const,
            },
          ],
        }));
        setScrollTrigger((prev) => prev + 1);
        return;
      }

      if (data.type === 'code_execution_result') {
        setPendingExecutions((prev) => ({
          ...prev,
          [data.messageId]: (prev[data.messageId] ?? []).map((execution) =>
            execution.executionId === data.data.executionId
              ? {
                  ...execution,
                  status: (data.data.denied ? 'denied' : 'completed') as
                    | 'denied'
                    | 'completed',
                  result: data.data,
                }
              : execution,
          ),
        }));
        // Also update ToolCall markup with result data for persistence
        // Look up the correct runId for this execution from the correlation map
        const tcId =
          codeExecutionRunIdMap.get(data.data.executionId) ||
          data.data.toolCallId;
        if (tcId) {
          const d = data.data;
          const extra: Record<string, string> = {};
          if (d.exitCode !== undefined) extra.exitCode = String(d.exitCode);
          if (d.stdout) extra.stdout = d.stdout.slice(0, 2000);
          if (d.stderr) extra.stderr = d.stderr.slice(0, 1000);
          if (d.timedOut) extra.timedOut = 'true';
          if (d.oomKilled) extra.oomKilled = 'true';
          if (d.denied) extra.denied = 'true';
          setMessages((prev) =>
            prev.map((message) => {
              if (message.messageId === data.messageId) {
                const updatedContent = updateToolCallMarkup(
                  message.content,
                  tcId,
                  { extra },
                );
                return { ...message, content: updatedContent };
              }
              return message;
            }),
          );
          recievedMessage = updateToolCallMarkup(recievedMessage, tcId, {
            extra,
          });
        }
        setScrollTrigger((prev) => prev + 1);
        return;
      }

      if (data.type === 'user_question_pending') {
        const runId = data.data?.markupToolCallId;
        if (runId && data.data?.questionId) {
          userQuestionRunIdMap.set(data.data.questionId, runId);
        }
        setPendingQuestions((prev) => ({
          ...prev,
          [data.messageId]: [
            ...(prev[data.messageId] ?? []),
            {
              questionId: data.data.questionId,
              question: data.data.question,
              options: data.data.options,
              multiSelect: data.data.multiSelect,
              allowFreeformInput: data.data.allowFreeformInput,
              context: data.data.context,
              toolCallId: data.data.toolCallId,
              createdAt: data.data.createdAt,
              status: 'pending' as const,
            },
          ],
        }));
        setScrollTrigger((prev) => prev + 1);
        return;
      }

      if (data.type === 'user_question_answered') {
        setPendingQuestions((prev) => ({
          ...prev,
          [data.messageId]: (prev[data.messageId] ?? []).map((q) =>
            q.questionId === data.data.questionId
              ? {
                  ...q,
                  status: (data.data.timedOut
                    ? 'timed_out'
                    : data.data.skipped
                      ? 'skipped'
                      : 'answered') as 'answered' | 'skipped' | 'timed_out',
                  response: data.data,
                }
              : q,
          ),
        }));
        const tcId =
          userQuestionRunIdMap.get(data.data.questionId) ||
          data.data.toolCallId;
        if (tcId) {
          const d = data.data;
          const extra: Record<string, string> = {};
          if (d.selectedOptions?.length)
            extra.selectedOptions = d.selectedOptions.join(', ');
          if (d.freeformText) extra.freeformText = d.freeformText.slice(0, 500);
          if (d.timedOut) extra.timedOut = 'true';
          if (d.skipped) extra.skipped = 'true';
          setMessages((prev) =>
            prev.map((message) => {
              if (message.messageId === data.messageId) {
                const updatedContent = updateToolCallMarkup(
                  message.content,
                  tcId,
                  { extra },
                );
                return { ...message, content: updatedContent };
              }
              return message;
            }),
          );
          recievedMessage = updateToolCallMarkup(recievedMessage, tcId, {
            extra,
          });
        }
        setScrollTrigger((prev) => prev + 1);
        return;
      }

      // Handle todo list updates
      if (data.type === 'todo_update') {
        setTodoItems(data.data.todos || []);
        return;
      }

      if (data.type === 'workspace_edit_approval_pending') {
        setPendingEditApprovals((prev) => ({
          ...prev,
          [data.messageId]: [
            ...(prev[data.messageId] ?? []),
            {
              approvalId: data.data.approvalId,
              toolCallId: data.data.toolCallId,
              action: data.data.action,
              workspaceId: data.data.workspaceId,
              fileId: data.data.fileId,
              file: data.data.file,
              oldString: data.data.oldString,
              newString: data.data.newString,
              content: data.data.content,
              replaceAll: data.data.replaceAll,
              occurrences: data.data.occurrences,
              workspaceAutoAccept: data.data.workspaceAutoAccept,
              fileAutoAccept: data.data.fileAutoAccept,
              createdAt: data.data.createdAt,
              status: 'pending' as const,
            },
          ],
        }));
        setScrollTrigger((prev) => prev + 1);
        return;
      }

      if (data.type === 'workspace_edit_approval_answered') {
        setPendingEditApprovals((prev) => ({
          ...prev,
          [data.messageId]: (prev[data.messageId] ?? []).map((a) =>
            a.approvalId === data.data.approvalId
              ? {
                  ...a,
                  status: (data.data.decision === 'reject' ||
                  data.data.decision === 'always_prompt'
                    ? 'rejected'
                    : 'accepted') as 'accepted' | 'rejected',
                }
              : a,
          ),
        }));
        return;
      }

      if (data.type === 'workspace_file_changed') {
        notifyWorkspaceUpdated(data.data.workspaceId);
        return;
      }

      if (data.type === 'response') {
        // Add to buffer instead of immediately updating UI
        messageBuffer += data.data;
        recievedMessage += data.data;
        tokenCount++;

        // Only update UI every bufferThreshold tokens
        if (tokenCount >= bufferThreshold || !added) {
          if (!added) {
            setMessages((prevMessages) => [
              ...prevMessages,
              {
                content: messageBuffer,
                messageId: data.messageId, // Use the AI message ID from the backend
                chatId: chatId!,
                role: 'assistant',
                sources: sources,
                createdAt: new Date(),
              },
            ]);
            added = true;
          } else {
            setMessages((prev) =>
              prev.map((message) => {
                if (message.messageId === data.messageId) {
                  return { ...message, content: recievedMessage };
                }
                return message;
              }),
            );
          }

          // Reset buffer and counter
          messageBuffer = '';
          tokenCount = 0;
          setScrollTrigger((prev) => prev + 1);
        }
      }

      if (data.type === 'messageEnd') {
        // Clear analysis progress and todo list
        setAnalysisProgress(null);
        setLiveModelStats(null);
        setTodoItems([]);

        // Ensure final message content is displayed (flush any remaining buffer)
        setMessages((prev) =>
          prev.map((message) => {
            if (message.messageId === data.messageId) {
              const usedLocationFlag =
                typeof data.usedLocation === 'boolean'
                  ? data.usedLocation
                  : undefined;
              const usedPersonalizationFlag =
                typeof data.usedPersonalization === 'boolean'
                  ? data.usedPersonalization
                  : undefined;
              const memoriesUsedCount = Array.isArray(data.memoriesUsed)
                ? data.memoriesUsed.length
                : typeof data.memoriesUsed === 'number'
                  ? data.memoriesUsed
                  : undefined;
              const mergedStats = data.modelStats
                ? {
                    ...data.modelStats,
                    ...(usedLocationFlag !== undefined
                      ? { usedLocation: usedLocationFlag }
                      : {}),
                    ...(usedPersonalizationFlag !== undefined
                      ? { usedPersonalization: usedPersonalizationFlag }
                      : {}),
                    ...(memoriesUsedCount !== undefined
                      ? { memoriesUsed: memoriesUsedCount }
                      : {}),
                  }
                : undefined;
              return {
                ...message,
                content: recievedMessage, // Use the complete received message
                // Include model stats if available, otherwise null
                modelStats: mergedStats || null,
                // Make sure the searchQuery is preserved (if available in the message data)
                searchQuery: message.searchQuery || data.searchQuery,
                searchUrl: message.searchUrl || data.searchUrl,
                ...(usedLocationFlag !== undefined
                  ? { usedLocation: usedLocationFlag }
                  : {}),
                ...(usedPersonalizationFlag !== undefined
                  ? { usedPersonalization: usedPersonalizationFlag }
                  : {}),
              };
            }
            return message;
          }),
        );

        setLoading(false);
        setGatheringSources([]); // Clear gathering sources when message is complete
        setLiveModelStats(null);
        setScrollTrigger((prev) => prev + 1);

        const lastMsg = messagesRef.current[messagesRef.current.length - 1];

        const autoSuggestions = localStorage.getItem('autoSuggestions');

        if (
          lastMsg.role === 'assistant' &&
          lastMsg.sources &&
          lastMsg.sources.length > 0 &&
          !lastMsg.suggestions &&
          autoSuggestions !== 'false' // Default to true if not set
        ) {
          const suggestions = await getSuggestions(messagesRef.current);
          setMessages((prev) =>
            prev.map((msg) => {
              if (msg.messageId === lastMsg.messageId) {
                return { ...msg, suggestions: suggestions };
              }
              return msg;
            }),
          );
        }
      }
    };

    const contextWindowSize = parseInt(
      localStorage.getItem('contextWindowSize') || '32768',
      10,
    );

    // Get the latest model selection from localStorage
    const currentChatModelProvider = localStorage.getItem('chatModelProvider');
    const currentChatModel = localStorage.getItem('chatModel');

    // Use the most current model selection from localStorage, falling back to the state if not available
    const modelProvider =
      currentChatModelProvider || chatModelProvider.provider;
    const modelName = currentChatModel || chatModelProvider.name;

    // Read System Model selection from localStorage; fallback to chat model
    const systemModelProvider =
      localStorage.getItem('systemModelProvider') || modelProvider;
    const systemModelName = localStorage.getItem('systemModel') || modelName;

    const payload: Record<string, unknown> = {
      content: message,
      message: {
        messageId: messageId,
        chatId: chatId!,
        content: message,
      },
      chatId: chatId!,
      files: fileIds,
      focusMode: focusMode,
      chatModel: {
        name: modelName,
        provider: modelProvider,
        contextWindowSize,
      },
      systemModel: {
        name: systemModelName,
        provider: systemModelProvider,
        contextWindowSize,
      },
      embeddingModel: {
        name: embeddingModelProvider.name,
        provider: embeddingModelProvider.provider,
      },
      selectedSystemPromptIds: systemPromptIds || [],
      selectedMethodologyId: selectedMethodologyId || undefined,
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

    // Memory settings from localStorage (disabled in private sessions)
    if (!isPrivateSession) {
      const memEnabled = localStorage.getItem('memoryEnabled') !== 'false';
      const memRetrievalEnabled =
        localStorage.getItem('memoryRetrievalEnabled') !== 'false';
      const memAutoDetection =
        localStorage.getItem('memoryAutoDetectionEnabled') !== 'false';
      if (memEnabled && memRetrievalEnabled) {
        payload.memoryEnabled = true;
      }
      if (memEnabled && memAutoDetection) {
        payload.memoryAutoDetection = true;
      }
    }

    if (isPrivateSession) {
      payload.isPrivate = true;
    }

    if (selectedWorkspaceId) {
      payload.workspaceId = selectedWorkspaceId;
    }

    if (imageCapable) {
      payload.imageCapable = true;
    }

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.body) throw new Error('No response body');

    const reader = res.body?.getReader();
    const decoder = new TextDecoder('utf-8');

    let partialChunk = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      partialChunk += decoder.decode(value, { stream: true });

      try {
        const messages = partialChunk.split('\n');
        for (const msg of messages) {
          if (!msg.trim()) continue;
          const json = JSON.parse(msg);
          messageHandler(json);
        }
        partialChunk = '';
      } catch (_error) {
        console.warn('Incomplete JSON, waiting for next chunk...');
      }
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

  // Context usage: use firstChatCallInputTokens from the most recent message
  // that has it — this is the input to the first model call of that turn
  // (system prompt + history), before tool results inflate it. Then add the
  // assistant's output text, since it will be part of the next request's input.
  // Falls back to a character-based estimate for messages that predate the metric.
  const contextUsage = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const stats = messages[i].modelStats;
      if (stats?.firstChatCallInputTokens) {
        const outputEstimate = Math.round(
          (messages[i].content?.length || 0) / 4,
        );
        return stats.firstChatCallInputTokens + outputEstimate;
      }
    }
    // Fallback: estimate from all message content
    const contentChars = messages.reduce(
      (sum, m) => sum + (m.content?.length || 0),
      0,
    );
    return Math.round(contentChars / 4) + 3000;
  })();

  const handleCompact = async (instructions?: string) => {
    if (!chatId || compacting) return;
    setCompacting(true);
    try {
      const contextWindowSize = parseInt(
        localStorage.getItem('contextWindowSize') || '32768',
        10,
      );

      const chatModelProvider =
        localStorage.getItem('chatModelProvider') || undefined;
      const chatModel = localStorage.getItem('chatModel') || undefined;
      const systemModelProvider =
        localStorage.getItem('systemModelProvider') || chatModelProvider;
      const systemModel = localStorage.getItem('systemModel') || chatModel;

      const res = await fetch('/api/chat/compact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatId,
          instructions,
          chatModel:
            chatModelProvider && chatModel
              ? {
                  provider: chatModelProvider,
                  name: chatModel,
                  contextWindowSize,
                }
              : undefined,
          systemModel:
            systemModelProvider && systemModel
              ? {
                  provider: systemModelProvider,
                  name: systemModel,
                  contextWindowSize,
                }
              : undefined,
        }),
      });
      if (res.ok) {
        // Reload messages from the server so all compaction checkpoint rows
        // are displayed at their correct positions in history.
        await loadMessages(
          chatId,
          setMessages,
          setIsMessagesLoaded,
          setFocusMode,
          setNotFound,
          setFiles,
          setFileIds,
          setIsPrivateSession,
          setPinned,
          setSelectedWorkspaceId,
        );
        toast.success('Conversation compacted');
      } else {
        toast.error('Compaction failed');
      }
    } catch {
      toast.error('Compaction failed');
    } finally {
      setCompacting(false);
    }
  };

  return isReady ? (
    notFound ? (
      <NextError statusCode={404} />
    ) : (
      <div>
        {messages.length > 0 ? (
          <>
            <ChatActions
              chatId={chatId!}
              messages={messages}
              isPrivateSession={isPrivateSession}
              pinned={pinned}
              setPinned={setPinned}
              workspaceId={selectedWorkspaceId ?? workspaceId}
            />
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
              selectedMethodologyId={selectedMethodologyId}
              setSelectedMethodologyId={setSelectedMethodologyId}
              onThinkBoxToggle={handleThinkBoxToggle}
              gatheringSources={gatheringSources}
              sendLocation={sendLocation}
              setSendLocation={setSendLocation}
              sendPersonalization={sendPersonalization}
              setSendPersonalization={setSendPersonalization}
              personalizationLocation={personalizationLocation}
              personalizationAbout={personalizationAbout}
              todoItems={todoItems}
              pendingExecutions={pendingExecutions}
              onExecutionAction={(executionId: string, approved: boolean) => {
                setPendingExecutions((prev) => {
                  const updated: Record<string, PendingExecution[]> = {};
                  for (const [msgId, executions] of Object.entries(prev)) {
                    updated[msgId] = executions.map((e) =>
                      e.executionId === executionId
                        ? {
                            ...e,
                            status: approved
                              ? ('approved' as const)
                              : ('denied' as const),
                          }
                        : e,
                    );
                  }
                  return updated;
                });
              }}
              pendingQuestions={pendingQuestions}
              onQuestionAnswer={async (
                questionId: string,
                response: {
                  selectedOptions?: string[];
                  freeformText?: string;
                },
              ) => {
                setPendingQuestions((prev) => {
                  const updated: Record<string, PendingQuestion[]> = {};
                  for (const [msgId, questions] of Object.entries(prev)) {
                    updated[msgId] = questions.map((q) =>
                      q.questionId === questionId
                        ? { ...q, status: 'answered' as const, response }
                        : q,
                    );
                  }
                  return updated;
                });
                try {
                  const res = await fetch('/api/chat/answer', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ questionId, ...response }),
                  });
                  if (!res.ok) throw new Error(`HTTP ${res.status}`);
                } catch {
                  toast.error(
                    'Failed to send answer. The agent will continue on its own.',
                  );
                }
              }}
              onQuestionSkip={async (questionId: string) => {
                setPendingQuestions((prev) => {
                  const updated: Record<string, PendingQuestion[]> = {};
                  for (const [msgId, questions] of Object.entries(prev)) {
                    updated[msgId] = questions.map((q) =>
                      q.questionId === questionId
                        ? { ...q, status: 'skipped' as const }
                        : q,
                    );
                  }
                  return updated;
                });
                try {
                  const res = await fetch('/api/chat/answer', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ questionId, skipped: true }),
                  });
                  if (!res.ok) throw new Error(`HTTP ${res.status}`);
                } catch {
                  toast.error(
                    'Failed to skip question. The agent will continue on its own.',
                  );
                }
              }}
              pendingEditApprovals={pendingEditApprovals}
              onEditDecide={async (
                approvalId: string,
                decision:
                  | 'accept'
                  | 'accept_always'
                  | 'reject'
                  | 'always_prompt',
                freeformText?: string,
              ) => {
                setPendingEditApprovals((prev) => {
                  const updated: Record<string, PendingEditApproval[]> = {};
                  for (const [msgId, approvals] of Object.entries(prev)) {
                    updated[msgId] = approvals.map((a) =>
                      a.approvalId === approvalId
                        ? {
                            ...a,
                            status: (decision === 'reject' ||
                            decision === 'always_prompt'
                              ? 'rejected'
                              : 'accepted') as 'accepted' | 'rejected',
                          }
                        : a,
                    );
                  }
                  return updated;
                });
                // Find the workspaceId for this approval
                let workspaceId: string | undefined;
                for (const approvals of Object.values(pendingEditApprovals)) {
                  const found = approvals.find(
                    (a) => a.approvalId === approvalId,
                  );
                  if (found) {
                    workspaceId = found.workspaceId;
                    break;
                  }
                }
                if (!workspaceId) return;
                try {
                  const res = await fetch(
                    `/api/workspaces/${workspaceId}/file-edit-approval`,
                    {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        approvalId,
                        decision,
                        freeformText,
                      }),
                    },
                  );
                  if (!res.ok) throw new Error(`HTTP ${res.status}`);
                } catch {
                  toast.error(
                    'Failed to send edit decision. The agent will continue on its own.',
                  );
                }
              }}
              pendingImages={pendingImages}
              setPendingImages={setPendingImages}
              imageCapable={imageCapable}
              isPrivateSession={isPrivateSession}
              searchCapabilities={
                isPrivateSession
                  ? searchCapabilitiesPrivate
                  : searchCapabilitiesRegular
              }
              estimatedUsage={contextUsage}
              messageCount={messages.length}
              onCompact={handleCompact}
              compacting={compacting}
            />
          </>
        ) : (
          <EmptyChat
            sendMessage={sendMessage}
            focusMode={focusMode}
            setFocusMode={setFocusMode}
            systemPromptIds={systemPromptIds}
            setSystemPromptIds={setSystemPromptIds}
            selectedMethodologyId={selectedMethodologyId}
            setSelectedMethodologyId={setSelectedMethodologyId}
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
            pendingImages={pendingImages}
            setPendingImages={setPendingImages}
            imageCapable={imageCapable}
            isPrivateSession={isPrivateSession}
            workspaceId={workspaceId}
            selectedWorkspaceId={selectedWorkspaceId}
            setSelectedWorkspaceId={
              workspaceId ? undefined : setSelectedWorkspaceId
            }
          />
        )}
      </div>
    )
  ) : (
    <div className="flex flex-row items-center justify-center min-h-screen">
      <LoaderCircle size={32} className="animate-spin text-accent" />
    </div>
  );
};

export default ChatWindow;
