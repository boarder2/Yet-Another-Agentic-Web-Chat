'use client';

import { useEffect, useRef, useState } from 'react';
import { updateToolCallMarkup } from '@/lib/utils/toolCallMarkup';
import { encodeHtmlAttribute } from '@/lib/utils/html';
import { Document } from '@langchain/core/documents';
import Navbar from './Navbar';
import Chat from './Chat';
import { PendingExecution } from './CodeExecution';
import { PendingQuestion } from './UserQuestionPrompt';
import EmptyChat from './EmptyChat';
import crypto from 'crypto';
import { toast } from 'sonner';
import { useSearchParams, usePathname } from 'next/navigation';
import { getSuggestions } from '@/lib/actions';
import { Settings } from 'lucide-react';
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
  setChatHistory: (history: [string, string, string[]?][]) => void,
  setFocusMode: (mode: string) => void,
  setNotFound: (notFound: boolean) => void,
  setFiles: (files: File[]) => void,
  setFileIds: (fileIds: string[]) => void,
  setIsPrivateSession?: (isPrivate: boolean) => void,
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

  setMessages(messages);

  const history = messages.map((msg) => {
    const role = msg.role === 'user' ? 'human' : msg.role;
    const entry: [string, string, string[]?] = [role, msg.content];
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
  if (setIsPrivateSession) {
    setIsPrivateSession(data.chat.isPrivate === 1);
  }
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

  const [pendingExecutions, setPendingExecutions] = useState<
    Record<string, PendingExecution[]>
  >({});

  const [pendingQuestions, setPendingQuestions] = useState<
    Record<string, PendingQuestion[]>
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

  const [isMessagesLoaded, setIsMessagesLoaded] = useState(false);

  const [notFound, setNotFound] = useState(false);

  const [isPrivateSession, setIsPrivateSession] = useState(
    () => searchParams.get('private') === '1',
  );

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
        setChatHistory,
        setFocusMode,
        setNotFound,
        setFiles,
        setFileIds,
        setIsPrivateSession,
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

    // Only act when we're on the root path (not a /c/... chat)
    if (pathname !== '/' || id) return;

    const isPriv = searchParams.get('private') === '1';
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
    setPendingExecutions({});
    setPendingQuestions({});
    setAnalysisProgress(null);
    setLiveModelStats(null);
    setNotFound(false);
    setIsPrivateSession(isPriv);
    setChatId(crypto.randomBytes(20).toString('hex'));
    document.title = 'Chat - YAAWC';
  }, [searchParams, pathname, id]);

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

        setChatHistory((prevHistory) => [
          ...prevHistory,
          messageImageIds?.length
            ? (['human', message, messageImageIds] as [
                string,
                string,
                string[],
              ])
            : (['human', message] as [string, string]),
          ['assistant', recievedMessage],
        ]);

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

    const ollamaContextWindow =
      localStorage.getItem('ollamaContextWindow') || '2048';

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
      history: messageChatHistory,
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

  return isReady ? (
    notFound ? (
      <NextError statusCode={404} />
    ) : (
      <div>
        {messages.length > 0 ? (
          <>
            <Navbar
              chatId={chatId!}
              messages={messages}
              isPrivateSession={isPrivateSession}
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
                response: { selectedOptions?: string[]; freeformText?: string },
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
              pendingImages={pendingImages}
              setPendingImages={setPendingImages}
              imageCapable={imageCapable}
              isPrivateSession={isPrivateSession}
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
