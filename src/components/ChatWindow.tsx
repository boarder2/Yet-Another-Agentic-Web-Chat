'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { updateToolCallMarkup } from '@/lib/utils/toolCallMarkup';
import { encodeHtmlAttribute } from '@/lib/utils/html';
import {
  applySubagentNestedToolCall,
  applySubagentResponseToken,
  applySubagentStatus,
} from '@/lib/utils/subagentMarkup';
import {
  applyPanelExecutorStarted,
  applyPanelExecutorResponseToken,
  applyPanelExecutorStatus,
  panelExecutorTokens,
} from '@/lib/utils/panelMarkup';
import {
  PANEL_SELECTION_KEY,
  isPanelSelectionReady,
  type PanelSelection,
} from '@/lib/panel/panelSelection';
import { ChartSpecContext } from '@/lib/chart/ChartSpecContext';
import { ChartSpec, ChartSpecSchema } from '@/lib/chart/chartSpec';
import { Document } from '@langchain/core/documents';
import ChatActions from './ChatActions';
import Chat from './Chat';
import { PendingExecution } from './CodeExecution';
import { PendingQuestion } from './UserQuestionPrompt';
import { PendingEditApproval } from './WorkspaceEditApproval';
import { PendingSkillEditApproval } from './SkillEditApproval';
import type { PendingMcpApproval } from './McpToolApproval';
import EmptyChat from './EmptyChat';
import crypto from 'crypto';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/api/keys';
import { apiFetch } from '@/lib/api/client';
import type { ActiveRunsData } from '@/lib/hooks/api/useActiveRuns';
import { useMarkChatSeen } from '@/lib/hooks/api/useActiveRuns';
import { useSearchParams, useRouter } from 'next/navigation';
import { getSuggestions } from '@/lib/actions';
import { SKILL_TOKEN_SCAN_REGEX } from '@/lib/skills/validation';
import { LoaderCircle, Settings } from 'lucide-react';
import { useSettingsModal } from '@/components/settings/SettingsModalProvider';
import NextError from 'next/error';
import {
  useLocalStorageBoolean,
  useLocalStorageString,
} from '@/lib/hooks/useLocalStorage';
import { DEFAULT_CONTEXT_WINDOW } from '@/lib/models/presets';

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
  usageImageGen?: TokenUsage & { modelName?: string };
  usedLocation?: boolean;
  usedPersonalization?: boolean;
  memoriesUsed?: number;
  firstChatCallInputTokens?: number;
  projectedNextInputTokens?: number;
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
  invokedSkills?: string[];
  /** Set when this row was written by an in-flight run. 'interrupted' means the
   *  server was restarted before the run completed. */
  runStatus?: 'running' | 'interrupted' | 'cancelled' | 'errored';
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
  onOpenApiKeys: () => void,
) => {
  try {
    let chatModel = localStorage.getItem('chatModel');
    let chatModelProvider = localStorage.getItem('chatModelProvider');
    let embeddingModel = localStorage.getItem('embeddingModel');
    let embeddingModelProvider = localStorage.getItem('embeddingModelProvider');

    const providers = await fetch(`/api/models`, {
      headers: { 'Content-Type': 'application/json' },
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
        }

        chatModelProvider =
          chatModelProvidersKeys.find(
            (provider) => Object.keys(chatModelProviders[provider]).length > 0,
          ) || chatModelProvidersKeys[0];

        if (
          chatModelProvider === 'custom_openai' &&
          Object.keys(chatModelProviders[chatModelProvider]).length === 0
        ) {
          toast.error(
            "Looks like you haven't configured any chat model providers. Please configure them in settings or the config file.",
            {
              action: { label: 'Open settings', onClick: onOpenApiKeys },
            },
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
            "Looks like you haven't configured any chat model providers. Please configure them in settings or the config file.",
            {
              action: { label: 'Open settings', onClick: onOpenApiKeys },
            },
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
  setLoading?: (loading: boolean) => void,
): Promise<{
  activeRunMessageId?: string;
  activeRunStatus?: string | null;
  workspaceId?: string | null;
  loadedMessages?: Message[];
}> => {
  const res = await fetch(`/api/chats/${chatId}`, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (res.status === 404) {
    setNotFound(true);
    setIsMessagesLoaded(true);
    return {};
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

  // If a run is still active (e.g. we just remounted onto /c/[chatId] right
  // after firing off the first message), flip loading on in the same batch as
  // setMessages. attachToRun does this too, but it runs a microtask later — by
  // then the partial assistant row has already rendered its "completed" footer
  // (rewrite/images/videos/related), causing a visible flicker before loading
  // hides it again. Gate on the same condition attachToRun uses (a running
  // assistant row present) so the two never disagree and leave loading stuck.
  const hasRunningAssistantRow = finalMessages.some(
    (m) => m.role === 'assistant' && m.runStatus === 'running',
  );
  if (setLoading && data.chat.activeRunMessageId && hasRunningAssistantRow) {
    setLoading(true);
  }

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
  return {
    activeRunMessageId: data.chat.activeRunMessageId ?? undefined,
    activeRunStatus: data.chat.activeRunStatus ?? null,
    workspaceId: data.chat.workspaceId ?? null,
    loadedMessages: finalMessages,
  };
};

// Carries the first message across the home → workspace navigation. When a new
// chat is started from a non-workspace route with a workspace selected, the
// home instance stashes the send here and routes to the workspace's /c/new
// page; the shell-wrapped instance there picks it up and performs the actual
// send, so the chat mounts inside the workspace shell with no bare-chat flash.
let pendingWorkspaceFirstSend: {
  message: string;
  images?: ImageAttachment[];
} | null = null;

const ChatWindow = ({
  id,
  workspaceId,
}: {
  id?: string;
  workspaceId?: string;
}) => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialMessage = searchParams.get('q');
  const queryClient = useQueryClient();
  const { openSettings } = useSettingsModal();

  // Write-through for the MCP approval "Always allow" action: atomically merge
  // { [toolName]: { approval: 'never' } } into the server's toolConfig (server
  // does the json_patch merge — no read-modify-write race) so the tool auto-runs
  // on subsequent calls. Best-effort; failures toast but never block the
  // in-flight approval.
  const persistMcpAlwaysAllow = useCallback(
    async (serverId: string, toolName: string) => {
      try {
        await apiFetch(`/api/mcp/servers/${serverId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            toolConfigPatch: { [toolName]: { approval: 'never' } },
          }),
        });
        // qk.mcpServers is a prefix of qk.mcpServer/qk.mcpServerTools, so this
        // invalidates the detail + tools queries too.
        queryClient.invalidateQueries({ queryKey: qk.mcpServers });
        toast.success(`Auto-run enabled for ${toolName}`);
      } catch {
        toast.error(`Couldn't save auto-run setting for ${toolName}`);
      }
    },
    [queryClient],
  );

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

  useEffect(() => {
    checkConfig(
      setChatModelProvider,
      setEmbeddingModelProvider,
      setIsConfigReady,
      setHasError,
      () => openSettings('api-keys'),
    );
  }, [openSettings]);

  const [loading, setLoading] = useState(false);
  const [scrollTrigger, setScrollTrigger] = useState(0);
  const [analysisProgress, setAnalysisProgress] = useState<{
    message: string;
    current: number;
    total: number;
    subMessage?: string;
  } | null>(null);
  const [liveModelStats, setLiveModelStats] = useState<ModelStats | null>(null);
  const [liveContextGrew, setLiveContextGrew] = useState<{
    kind: string;
    tokens: number;
    totalEstimated: number;
    at: number;
  } | null>(null);

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

  const [pendingSkillEditApprovals, setPendingSkillEditApprovals] = useState<
    Record<string, PendingSkillEditApproval[]>
  >({});

  const [pendingMcpApprovals, setPendingMcpApprovals] = useState<
    Record<string, PendingMcpApproval[]>
  >({});

  // Enabled user skills for slash-command invocation and autocomplete
  const [enabledUserSkillNames, setEnabledUserSkillNames] = useState<
    Set<string>
  >(new Set());
  const [enabledSkillsForAutocomplete, setEnabledSkillsForAutocomplete] =
    useState<Array<{ name: string; description: string }>>([]);

  // Per-message chart spec map: messageId → (chartId → ChartSpec)
  // Also exposed as a flat chartId → ChartSpec map via ChartSpecContext
  const [chartSpecsByMessage, setChartSpecsByMessage] = useState<
    Record<string, Record<string, ChartSpec>>
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

  // On a brand-new chat the private toggle navigates by flipping the ?private=
  // query param. useState's initializer only runs on mount, so sync the state
  // from the URL on those navigations. Restrict to before the first send: an
  // existing chat (id set) gets its flag from the DB via loadMessages, and once
  // a message is sent the URL is replaced without the param (see history
  // .replaceState below), which must not clear an active private session.
  const privateParam = searchParams.get('private') === '1';
  const [prevPrivateParam, setPrevPrivateParam] = useState(privateParam);
  if (privateParam !== prevPrivateParam) {
    setPrevPrivateParam(privateParam);
    if (id === undefined && messages.length === 0) {
      setIsPrivateSession(privateParam);
    }
  }

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

  const messagesRef = useRef<Message[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Aborts the in-flight run/attach stream fetch. On unmount we abort it so the
  // server-side subscriber is dropped immediately: run completion then sees no
  // live subscriber and correctly leaves the thread unread. Without this the
  // reader loop keeps the request open after navigation, making the run look
  // "still watched" and marking it read.
  const streamAbortRef = useRef<AbortController | null>(null);
  // The active run's user message id (run key). Tracked so resume-submit
  // handlers can re-attach to the stream after answering an approval — needed
  // when the run was reconstructed (server restart / hub eviction) and no live
  // subscription exists, otherwise the resumed response never streams to the
  // client and the Stop button never appears.
  const activeRunMessageIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    return () => {
      streamAbortRef.current?.abort();
    };
  }, []);

  // Utility: read a newline-delimited JSON stream and dispatch each object to handler.
  const readStream = async (
    reader: ReadableStreamDefaultReader<Uint8Array>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    handler: (data: Record<string, any>) => Promise<void> | void,
  ) => {
    const decoder = new TextDecoder('utf-8');
    let partialChunk = '';
    while (true) {
      let value: Uint8Array | undefined;
      let done: boolean;
      try {
        ({ value, done } = await reader.read());
      } catch (err) {
        // Aborted on unmount/navigation — stop quietly; the run continues
        // server-side and the unread state is settled at completion.
        if (err instanceof DOMException && err.name === 'AbortError') return;
        throw err;
      }
      if (done) break;
      partialChunk += decoder.decode(value, { stream: true });
      try {
        const lines = partialChunk.split('\n');
        for (const line of lines) {
          if (!line.trim()) continue;
          const json = JSON.parse(line);
          await handler(json);
        }
        partialChunk = '';
      } catch (_error) {
        console.warn('Incomplete JSON, waiting for next chunk...');
      }
    }
  };

  // Load enabled user skills for slash-command invocation
  const refreshEnabledSkills = useCallback(() => {
    const params = new URLSearchParams();
    params.set('enabled', 'true');
    if (selectedWorkspaceId) params.set('workspaceId', selectedWorkspaceId);
    fetch(`/api/skills?${params}`)
      .then((r) => r.json())
      .then((rows: Array<{ name: string; description: string }>) => {
        setEnabledUserSkillNames(new Set(rows.map((r) => r.name)));
        setEnabledSkillsForAutocomplete(
          rows.map((r) => ({ name: r.name, description: r.description })),
        );
      })
      .catch(() => {});
  }, [selectedWorkspaceId]);

  // Attach to an already-running run (e.g. after a page refresh).
  // The partial assistant row is already loaded in `messages`; we replay
  // the event buffer from the server and tail live events.
  const attachToRun = async (
    userMessageId: string,
    loadedMessages?: Message[],
  ) => {
    activeRunMessageIdRef.current = userMessageId;
    const msgs = loadedMessages ?? messagesRef.current;
    const partialMsg = msgs.find(
      (m) => m.role === 'assistant' && m.runStatus === 'running',
    );
    if (!partialMsg) return; // No running row — might already be interrupted

    const aiMessageId = partialMsg.messageId;

    setLoading(true);
    setGatheringSources([]);
    setLiveModelStats(null);
    setAnalysisProgress(null);

    let recievedMessage = partialMsg.content ?? '';
    // Events replayed from the server buffer are already baked into the
    // persisted content seeded above. Stay in replay mode until the server's
    // `replay_complete` sentinel, then append only the live (post-resume)
    // tokens. Without this, post-resume answer tokens were dropped up to the
    // seeded content length, losing the start of a resumed answer.
    let inReplay = true;
    const codeExecutionRunIdMap = new Map<string, string>();
    const userQuestionRunIdMap = new Map<string, string>();

    streamAbortRef.current?.abort();
    const abortController = new AbortController();
    streamAbortRef.current = abortController;

    let res: Response;
    try {
      res = await fetch(
        `/api/chat/runs/${userMessageId}/stream?from=0&chatId=${chatId}`,
        { signal: abortController.signal },
      );
    } catch {
      // A superseding attach (e.g. StrictMode double-invoke or a rapid
      // re-subscribe) or an unmount aborted this fetch. The newer attach now
      // owns the loading state, so don't clear it here — doing so would leave
      // the resumed run streaming with no Stop button or loading indicators.
      if (abortController.signal.aborted) return;
      setLoading(false);
      return;
    }
    if (abortController.signal.aborted) return;
    if (!res.body) {
      setLoading(false);
      return;
    }
    const reader = res.body.getReader();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const attachHandler = async (data: Record<string, any>) => {
      if (data.type === 'gone') {
        setLoading(false);
        setMessages((prev) =>
          prev.map((m) =>
            m.messageId === aiMessageId ? { ...m, runStatus: undefined } : m,
          ),
        );
        return;
      }

      if (data.type === 'error') {
        toast.error(data.data);
        setLoading(false);
        return;
      }

      if (data.type === 'ping') return;

      if (data.type === 'replay_complete') {
        inReplay = false;
        return;
      }

      if (data.type === 'progress') {
        setAnalysisProgress(data.data);
        return;
      }
      if (data.type === 'stats') {
        setLiveModelStats(data.data);
        return;
      }
      if (data.type === 'context_grew') {
        setLiveContextGrew({
          kind: data.kind,
          tokens: data.tokens,
          totalEstimated: data.totalEstimated,
          at: Date.now(),
        });
        return;
      }

      if (data.type === 'sources_added') {
        if (data.searchQuery?.trim()) {
          setGatheringSources((prev) => {
            const existingIndex = prev.findIndex(
              (g) => g.searchQuery === data.searchQuery,
            );
            if (existingIndex >= 0) {
              const updated = [...prev];
              updated[existingIndex] = {
                searchQuery: data.searchQuery,
                sources: [...updated[existingIndex].sources, ...data.data],
              };
              return updated;
            }
            return [
              ...prev,
              { searchQuery: data.searchQuery, sources: data.data },
            ];
          });
        }
        return;
      }

      if (data.type === 'sources') {
        setMessages((prev) =>
          prev.map((m) =>
            m.messageId === aiMessageId
              ? {
                  ...m,
                  sources: data.data,
                  searchQuery: data.searchQuery,
                  searchUrl: data.searchUrl,
                }
              : m,
          ),
        );
        return;
      }

      if (data.type === 'response') {
        if (inReplay) return;
        const token: string = data.data ?? '';
        recievedMessage += token;
        setMessages((prev) =>
          prev.map((m) =>
            m.messageId === aiMessageId
              ? { ...m, content: recievedMessage }
              : m,
          ),
        );
        setScrollTrigger((prev) => prev + 1);
        return;
      }

      if (
        data.type === 'tool_call_started' ||
        data.type === 'tool_call_success' ||
        data.type === 'tool_call_error'
      ) {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.messageId !== aiMessageId) return m;
            let content = m.content;
            if (data.type === 'tool_call_started' && data.data?.content) {
              if (!content.includes(data.data.toolCallId ?? '')) {
                content += data.data.content;
              }
            } else {
              content = updateToolCallMarkup(content, data.data.toolCallId, {
                status: data.data.status,
                error: data.data.error,
                extra: data.data.extra,
              });
            }
            recievedMessage = content;
            return { ...m, content };
          }),
        );
        setScrollTrigger((prev) => prev + 1);
        return;
      }

      if (
        data.type === 'subagent_started' ||
        data.type === 'subagent_completed' ||
        data.type === 'subagent_error'
      ) {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.messageId !== aiMessageId) return m;
            let content = m.content;
            if (
              data.type === 'subagent_started' &&
              !content.includes(`id="${data.executionId}"`)
            ) {
              content += `<SubagentExecution id="${data.executionId}" name="${encodeHtmlAttribute(data.name ?? '')}" task="${encodeHtmlAttribute(data.task ?? '')}" status="running"></SubagentExecution>\n`;
            } else if (
              data.type === 'subagent_completed' ||
              data.type === 'subagent_error'
            ) {
              const status =
                data.type === 'subagent_completed' ? 'success' : 'error';
              content = applySubagentStatus(
                content,
                data.id,
                status,
                data.summary,
                data.error,
              );
            }
            recievedMessage = content;
            return { ...m, content };
          }),
        );
        setScrollTrigger((prev) => prev + 1);
        return;
      }

      // Nested subagent events (tool calls + streamed response tokens). The
      // live-stream handler nests these inside the SubagentExecution widget;
      // the reconnect path must do the same or the subagent's tool calls render
      // outside the widget after returning to a backgrounded run. Transforms are
      // idempotent so replayed/seeded markup is not duplicated.
      if (data.type === 'subagent_data') {
        const nestedEvent = data.data;
        const executionId = data.subagentId;
        const transform = (content: string): string => {
          if (nestedEvent?.type === 'response') {
            return applySubagentResponseToken(
              content,
              executionId,
              nestedEvent.data || '',
            );
          }
          if (nestedEvent?.type?.startsWith('tool_call')) {
            return applySubagentNestedToolCall(
              content,
              executionId,
              nestedEvent,
            );
          }
          return content;
        };
        setMessages((prev) =>
          prev.map((m) =>
            m.messageId === aiMessageId
              ? { ...m, content: transform(m.content) }
              : m,
          ),
        );
        recievedMessage = transform(recievedMessage);
        setScrollTrigger((prev) => prev + 1);
        return;
      }

      // Agent panel executor lifecycle. started/completed/error are idempotent
      // milestones; data (token streams) is gated by inReplay since the seeded
      // content already contains the accumulated panel responseText.
      if (
        data.type === 'panel_executor_started' ||
        data.type === 'panel_executor_completed' ||
        data.type === 'panel_executor_error'
      ) {
        const idx = data.executorIdx as number;
        const transform = (content: string): string => {
          if (data.type === 'panel_executor_started') {
            return applyPanelExecutorStarted(
              content,
              idx,
              data.model ?? `Model ${idx + 1}`,
            );
          }
          if (data.type === 'panel_executor_completed') {
            return applyPanelExecutorStatus(content, idx, 'success', {
              sourceCount: data.sourceCount,
              tokens: panelExecutorTokens(data.usage),
              model: data.model,
            });
          }
          return applyPanelExecutorStatus(content, idx, 'error', {
            error: data.error,
            model: data.model,
          });
        };
        setMessages((prev) =>
          prev.map((m) =>
            m.messageId === aiMessageId
              ? { ...m, content: transform(m.content) }
              : m,
          ),
        );
        recievedMessage = transform(recievedMessage);
        setScrollTrigger((prev) => prev + 1);
        return;
      }

      if (data.type === 'panel_executor_data') {
        if (inReplay) return;
        const idx = data.executorIdx as number;
        const token: string = data.token ?? '';
        setMessages((prev) =>
          prev.map((m) =>
            m.messageId === aiMessageId
              ? {
                  ...m,
                  content: applyPanelExecutorResponseToken(
                    m.content,
                    idx,
                    token,
                  ),
                }
              : m,
          ),
        );
        recievedMessage = applyPanelExecutorResponseToken(
          recievedMessage,
          idx,
          token,
        );
        setScrollTrigger((prev) => prev + 1);
        return;
      }

      if (data.type === 'chart_spec') {
        const { chartId, spec } = data.data ?? {};
        if (chartId && spec) {
          setChartSpecsByMessage((prev) => ({
            ...prev,
            [aiMessageId]: { ...(prev[aiMessageId] ?? {}), [chartId]: spec },
          }));
        }
        return;
      }

      if (data.type === 'todo_update') {
        setTodoItems(data.data.todos || []);
        return;
      }

      if (data.type === 'code_execution_pending') {
        // Replayed/persisted pending events carry approvalId, not executionId.
        const executionId = data.data?.approvalId ?? data.data?.executionId;
        const runId = data.data?.markupToolCallId;
        if (runId && executionId) codeExecutionRunIdMap.set(executionId, runId);
        // The result event carries only toolCallId, so key the map on it too.
        if (runId && data.data?.toolCallId)
          codeExecutionRunIdMap.set(data.data.toolCallId, runId);
        setPendingExecutions((prev) => {
          const existing = prev[aiMessageId] ?? [];
          // Dedup against the /api/approvals/pending fetch path (same executionId).
          if (existing.some((e) => e.executionId === executionId)) return prev;
          return {
            ...prev,
            [aiMessageId]: [
              ...existing,
              {
                executionId,
                code: data.data.code,
                description: data.data.description,
                toolCallId: data.data.toolCallId,
                status: 'pending' as const,
              },
            ],
          };
        });
        return;
      }

      if (data.type === 'code_execution_answered') {
        const answeredExecId = data.data?.approvalId ?? data.data?.executionId;
        const approved = (data.data?.response as Record<string, unknown>)
          ?.approved;
        if (answeredExecId) {
          setPendingExecutions((prev) => {
            const updated: Record<string, PendingExecution[]> = {};
            for (const [msgId, executions] of Object.entries(prev)) {
              updated[msgId] = executions.map((e) =>
                e.executionId === answeredExecId
                  ? {
                      ...e,
                      status: (approved === false ? 'denied' : 'approved') as
                        | 'approved'
                        | 'denied',
                    }
                  : e,
              );
            }
            return updated;
          });
        }
        return;
      }

      if (data.type === 'code_execution_result') {
        setPendingExecutions((prev) => ({
          ...prev,
          [aiMessageId]: (prev[aiMessageId] ?? []).map((execution) =>
            (data.data.executionId &&
              execution.executionId === data.data.executionId) ||
            (data.data.toolCallId &&
              execution.toolCallId === data.data.toolCallId)
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
        const tcId =
          codeExecutionRunIdMap.get(data.data.executionId) ||
          codeExecutionRunIdMap.get(data.data.toolCallId) ||
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
          if (Array.isArray(d.chartIds) && d.chartIds.length > 0)
            extra.chartIds = d.chartIds.join(',');
          setMessages((prev) =>
            prev.map((message) =>
              message.messageId === aiMessageId
                ? {
                    ...message,
                    content: updateToolCallMarkup(message.content, tcId, {
                      extra,
                    }),
                  }
                : message,
            ),
          );
          recievedMessage = updateToolCallMarkup(recievedMessage, tcId, {
            extra,
          });
        }
        setScrollTrigger((prev) => prev + 1);
        return;
      }

      if (
        data.type === 'user_question_pending' ||
        data.type === 'ask_user_pending'
      ) {
        // Replayed/persisted pending events carry approvalId, not questionId.
        const questionId = data.data?.approvalId ?? data.data?.questionId;
        const runId = data.data?.markupToolCallId;
        if (runId && questionId) userQuestionRunIdMap.set(questionId, runId);
        if (runId && data.data?.toolCallId)
          userQuestionRunIdMap.set(data.data.toolCallId, runId);
        setPendingQuestions((prev) => {
          const existing = prev[aiMessageId] ?? [];
          // Dedup against the /api/approvals/pending fetch path (same questionId).
          if (existing.some((q) => q.questionId === questionId)) return prev;
          return {
            ...prev,
            [aiMessageId]: [
              ...existing,
              {
                questionId,
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
          };
        });
        return;
      }

      if (
        data.type === 'user_question_answered' ||
        data.type === 'ask_user_answered'
      ) {
        const answeredId = data.data?.approvalId ?? data.data?.questionId;
        setPendingQuestions((prev) => ({
          ...prev,
          [aiMessageId]: (prev[aiMessageId] ?? []).map((q) =>
            q.questionId === answeredId
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
          userQuestionRunIdMap.get(answeredId) ||
          userQuestionRunIdMap.get(data.data.toolCallId) ||
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
            prev.map((message) =>
              message.messageId === aiMessageId
                ? {
                    ...message,
                    content: updateToolCallMarkup(message.content, tcId, {
                      extra,
                    }),
                  }
                : message,
            ),
          );
          recievedMessage = updateToolCallMarkup(recievedMessage, tcId, {
            extra,
          });
        }
        return;
      }

      if (
        data.type === 'workspace_edit_approval_pending' ||
        data.type === 'workspace_edit_pending' ||
        data.type === 'workspace_create_pending'
      ) {
        setPendingEditApprovals((prev) => {
          const existing = prev[aiMessageId] ?? [];
          if (existing.some((a) => a.approvalId === data.data.approvalId))
            return prev;
          return {
            ...prev,
            [aiMessageId]: [
              ...existing,
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
          };
        });
        return;
      }

      if (
        data.type === 'workspace_edit_approval_answered' ||
        data.type === 'workspace_edit_answered' ||
        data.type === 'workspace_create_answered'
      ) {
        setPendingEditApprovals((prev) => ({
          ...prev,
          [aiMessageId]: (prev[aiMessageId] ?? []).map((a) =>
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
        queryClient.invalidateQueries({
          queryKey: ['workspaces', data.data.workspaceId],
        });
        return;
      }

      if (
        data.type === 'skill_edit_approval_pending' ||
        data.type === 'skill_edit_pending'
      ) {
        setPendingSkillEditApprovals((prev) => {
          const existing = prev[aiMessageId] ?? [];
          if (existing.some((a) => a.approvalId === data.data.approvalId))
            return prev;
          return {
            ...prev,
            [aiMessageId]: [
              ...existing,
              {
                approvalId: data.data.approvalId,
                toolCallId: data.data.toolCallId,
                action: data.data.action,
                name: data.data.name,
                oldDescription: data.data.oldDescription,
                newDescription: data.data.newDescription,
                oldContent: data.data.oldContent,
                newContent: data.data.newContent,
                scope: data.data.scope,
                workspaceId: data.data.workspaceId,
                skillId: data.data.skillId,
                createdAt: data.data.createdAt,
                status: 'pending' as const,
              },
            ],
          };
        });
        return;
      }

      if (
        data.type === 'skill_edit_approval_answered' ||
        data.type === 'skill_edit_answered'
      ) {
        setPendingSkillEditApprovals((prev) => ({
          ...prev,
          [aiMessageId]: (prev[aiMessageId] ?? []).map((a) =>
            a.approvalId === data.data.approvalId
              ? {
                  ...a,
                  status: (data.data.decision === 'reject'
                    ? 'rejected'
                    : 'accepted') as 'accepted' | 'rejected',
                }
              : a,
          ),
        }));
        if (
          data.data.decision !== 'reject' &&
          data.data.decision !== 'always_prompt' &&
          !data.data.timedOut
        ) {
          refreshEnabledSkills();
        }
        return;
      }

      if (data.type === 'mcp_tool_pending') {
        setPendingMcpApprovals((prev) => {
          const existing = prev[aiMessageId] ?? [];
          if (existing.some((a) => a.approvalId === data.data.approvalId))
            return prev;
          return {
            ...prev,
            [aiMessageId]: [
              ...existing,
              {
                approvalId: data.data.approvalId,
                toolCallId: data.data.toolCallId,
                serverId: data.data.serverId,
                serverName: data.data.serverName,
                toolName: data.data.toolName,
                namespacedName: data.data.namespacedName,
                description: data.data.description,
                arguments: data.data.arguments ?? {},
                createdAt: data.data.createdAt,
                status: 'pending' as const,
              },
            ],
          };
        });
        return;
      }

      if (data.type === 'mcp_tool_answered') {
        setPendingMcpApprovals((prev) => ({
          ...prev,
          [aiMessageId]: (prev[aiMessageId] ?? []).map((a) =>
            a.approvalId === data.data.approvalId
              ? {
                  ...a,
                  status: (data.data.response?.approved === false
                    ? 'denied'
                    : 'approved') as 'approved' | 'denied',
                }
              : a,
          ),
        }));
        return;
      }

      if (data.type?.endsWith('_stale')) {
        const approvalId = data.data?.approvalId as string | undefined;
        const reason = data.data?.reason as string | undefined;
        toast.error(
          reason
            ? `${reason} The assistant will re-check and try again.`
            : 'The target changed while awaiting approval; the assistant will re-check and try again.',
        );
        if (approvalId) {
          setPendingEditApprovals((prev) => {
            const updated: Record<string, PendingEditApproval[]> = {};
            for (const [msgId, items] of Object.entries(prev)) {
              updated[msgId] = items.map((a) =>
                a.approvalId === approvalId
                  ? { ...a, status: 'cancelled' as const }
                  : a,
              );
            }
            return updated;
          });
          setPendingSkillEditApprovals((prev) => {
            const updated: Record<string, PendingSkillEditApproval[]> = {};
            for (const [msgId, items] of Object.entries(prev)) {
              updated[msgId] = items.map((a) =>
                a.approvalId === approvalId
                  ? { ...a, status: 'cancelled' as const }
                  : a,
              );
            }
            return updated;
          });
          setPendingMcpApprovals((prev) => {
            const updated: Record<string, PendingMcpApproval[]> = {};
            for (const [msgId, items] of Object.entries(prev)) {
              updated[msgId] = items.map((a) =>
                a.approvalId === approvalId
                  ? { ...a, status: 'cancelled' as const }
                  : a,
              );
            }
            return updated;
          });
          setPendingQuestions((prev) => {
            const updated: Record<string, PendingQuestion[]> = {};
            for (const [msgId, items] of Object.entries(prev)) {
              updated[msgId] = items.map((q) =>
                q.questionId === approvalId
                  ? { ...q, status: 'cancelled' as const }
                  : q,
              );
            }
            return updated;
          });
        }
        return;
      }

      if (data.type?.endsWith('_cancelled') && !data.type.endsWith('_stale')) {
        const cancelledApprovalId = data.data?.approvalId as string | undefined;
        if (cancelledApprovalId) {
          setPendingQuestions((prev) => {
            const updated: Record<string, PendingQuestion[]> = {};
            for (const [msgId, items] of Object.entries(prev)) {
              updated[msgId] = items.map((q) =>
                q.questionId === cancelledApprovalId
                  ? { ...q, status: 'cancelled' as const }
                  : q,
              );
            }
            return updated;
          });
          setPendingExecutions((prev) => {
            const updated: Record<string, PendingExecution[]> = {};
            for (const [msgId, items] of Object.entries(prev)) {
              updated[msgId] = items.map((e) =>
                e.executionId === cancelledApprovalId
                  ? { ...e, status: 'cancelled' as const }
                  : e,
              );
            }
            return updated;
          });
          setPendingEditApprovals((prev) => {
            const updated: Record<string, PendingEditApproval[]> = {};
            for (const [msgId, items] of Object.entries(prev)) {
              updated[msgId] = items.map((a) =>
                a.approvalId === cancelledApprovalId
                  ? { ...a, status: 'cancelled' as const }
                  : a,
              );
            }
            return updated;
          });
          setPendingSkillEditApprovals((prev) => {
            const updated: Record<string, PendingSkillEditApproval[]> = {};
            for (const [msgId, items] of Object.entries(prev)) {
              updated[msgId] = items.map((a) =>
                a.approvalId === cancelledApprovalId
                  ? { ...a, status: 'cancelled' as const }
                  : a,
              );
            }
            return updated;
          });
          setPendingMcpApprovals((prev) => {
            const updated: Record<string, PendingMcpApproval[]> = {};
            for (const [msgId, items] of Object.entries(prev)) {
              updated[msgId] = items.map((a) =>
                a.approvalId === cancelledApprovalId
                  ? { ...a, status: 'cancelled' as const }
                  : a,
              );
            }
            return updated;
          });
        }
        return;
      }

      if (data.type === 'messageEnd') {
        setAnalysisProgress(null);
        setLiveModelStats(null);
        setLiveContextGrew(null);
        setTodoItems([]);
        setMessages((prev) =>
          prev.map((m) => {
            if (m.messageId !== aiMessageId) return m;
            return {
              ...m,
              content: recievedMessage,
              modelStats: data.modelStats ?? null,
              searchQuery: m.searchQuery || data.searchQuery,
              searchUrl: m.searchUrl || data.searchUrl,
              runStatus: undefined, // run finished successfully
            };
          }),
        );
        setLoading(false);
        setGatheringSources([]);
        setScrollTrigger((prev) => prev + 1);
      }
    };

    await readStream(reader, attachHandler);
    // Stream finished — drop the completed controller so a later tab-hide
    // doesn't treat it as an in-flight run (see the send path for details).
    if (streamAbortRef.current === abortController) {
      streamAbortRef.current = null;
    }
  };

  // Re-subscribe to the active run after answering an approval. Needed when the
  // run was reconstructed (server restart / hub eviction): no live SSE
  // subscription exists, so without this the resumed response never streams to
  // the client and the Stop button never appears. Re-marks the run's assistant
  // row as running (a prior `gone` cleared it) and re-opens the stream.
  const reattachToActiveRun = () => {
    const runMsgId = activeRunMessageIdRef.current;
    if (!runMsgId) return;
    let lastAssistantIdx = -1;
    for (let i = messagesRef.current.length - 1; i >= 0; i--) {
      if (messagesRef.current[i].role === 'assistant') {
        lastAssistantIdx = i;
        break;
      }
    }
    if (lastAssistantIdx === -1) return;
    const msgs = messagesRef.current.map((m, i) =>
      i === lastAssistantIdx ? { ...m, runStatus: 'running' as const } : m,
    );
    setMessages(msgs);
    attachToRun(runMsgId, msgs);
  };

  // Background-unread: while a run is streaming, a backgrounded tab keeps its
  // fetch open, so the server still counts this client as "watching" and marks
  // the run read on completion. Drop the live stream when the tab is hidden
  // (same abort-the-fetch mechanism as the navigation cleanup above, see
  // streamAbortRef) so a run that finishes while hidden correctly stays unread.
  // On return, soft-reload from the DB to pick up whatever streamed while we
  // were disconnected, re-attaching if the run is still in flight.
  const markSeen = useMarkChatSeen();
  const suspendedForHiddenRef = useRef(false);
  // Latest-ref for the resume logic so the once-registered listener always runs
  // against the current closures — chatId is state and is assigned only after
  // the first send on a brand-new chat, so a value captured at mount would be
  // undefined and the resume would silently bail.
  const resumeFromHiddenRef = useRef<() => void>(() => {});
  // Refresh the closure after every render so it captures the current chatId.
  useEffect(() => {
    resumeFromHiddenRef.current = () => {
      if (!chatId) return;
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
        setLoading,
      )
        .then(({ activeRunMessageId, loadedMessages } = {}) => {
          if (activeRunMessageId) {
            attachToRun(activeRunMessageId, loadedMessages);
          } else {
            // Finished while hidden — clear the spinner the aborted stream left
            // on and mark the chat seen now that the user is looking at the
            // result. (The server only auto-marks seen when a subscriber was
            // connected at completion; we deliberately disconnected on hide, so
            // do it here.)
            setLoading(false);
            markSeen.mutate(chatId);
          }
        })
        .catch((err) => {
          // A failed reload (network blip on wake, server error) must still
          // clear the spinner the aborted stream left behind, or it hangs
          // forever; leave the chat unseen so the next visit retries.
          console.error('Resume-from-hidden reload failed:', err);
          setLoading(false);
        });
    };
  });
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        const ac = streamAbortRef.current;
        if (ac && !ac.signal.aborted) {
          ac.abort();
          suspendedForHiddenRef.current = true;
        }
        return;
      }
      if (!suspendedForHiddenRef.current) return;
      suspendedForHiddenRef.current = false;
      resumeFromHiddenRef.current();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () =>
      document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  // One-time mount init: either load an existing chat or establish a fresh
  // chat id. The synchronous setState in the new-chat branch is intentional
  // initialization, not a render-driven update.
  /* eslint-disable react-hooks/set-state-in-effect */
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
        setLoading,
      ).then(
        ({
          activeRunMessageId,
          activeRunStatus,
          workspaceId: chatWorkspaceId,
          loadedMessages,
        } = {}) => {
          // If a workspace chat was opened on the non-workspace /c/[chatId] route
          // (e.g. a direct deep-link), route to the real workspace URL so it
          // mounts under the workspace layout instead of rendering bare.
          if (!workspaceId && chatWorkspaceId) {
            router.replace(`/workspaces/${chatWorkspaceId}/c/${chatId}`);
            return;
          }
          if (activeRunMessageId) {
            attachToRun(activeRunMessageId, loadedMessages);
          }
          // For awaiting_user runs: directly fetch pending approvals from DB so the
          // input prompts are restored even if the SSE stream is gone (server restart).
          if (activeRunStatus === 'awaiting_user' && chatId) {
            fetch(`/api/approvals/pending?chatId=${chatId}`)
              .then((r) => r.json())
              .then(
                (data: {
                  pending?: Array<{
                    approvalId: string;
                    messageId: string;
                    toolKind: string;
                    payload: Record<string, unknown>;
                  }>;
                }) => {
                  if (!data.pending?.length) return;
                  // Bucket key MUST match the SSE-replay path (attachToRun keys
                  // by the running assistant message id, not the user message id
                  // that approval records carry). Using a different key would put
                  // the same approvals in a second bucket, defeating the
                  // questionId dedup below and double-counting the queue.
                  const runningAssistantId = (loadedMessages ?? []).find(
                    (m) => m.role === 'assistant' && m.runStatus === 'running',
                  )?.messageId;
                  for (const approval of data.pending) {
                    const key = runningAssistantId ?? approval.messageId;
                    const p = approval.payload;
                    if (approval.toolKind === 'ask_user') {
                      setPendingQuestions((prev) => {
                        // Skip if already populated (e.g. from SSE replay)
                        const existing = prev[key] ?? [];
                        if (
                          existing.some(
                            (q) => q.questionId === approval.approvalId,
                          )
                        )
                          return prev;
                        return {
                          ...prev,
                          [key]: [
                            ...existing,
                            {
                              questionId: approval.approvalId,
                              question: p.question as string,
                              options: p.options as
                                | { label: string; description?: string }[]
                                | undefined,
                              multiSelect: p.multiSelect as boolean | undefined,
                              allowFreeformInput: p.allowFreeformInput as
                                | boolean
                                | undefined,
                              context: p.context as string | undefined,
                              toolCallId: p.toolCallId as string | undefined,
                              createdAt: p.createdAt as number | undefined,
                              status: 'pending' as const,
                            },
                          ],
                        };
                      });
                    } else if (approval.toolKind === 'code_execution') {
                      setPendingExecutions((prev) => {
                        const existing = prev[key] ?? [];
                        if (
                          existing.some(
                            (e) => e.executionId === approval.approvalId,
                          )
                        )
                          return prev;
                        return {
                          ...prev,
                          [key]: [
                            ...existing,
                            {
                              executionId: approval.approvalId,
                              code: p.code as string,
                              description: p.description as string | undefined,
                              toolCallId: p.toolCallId as string | undefined,
                              status: 'pending' as const,
                            },
                          ],
                        };
                      });
                    } else if (
                      approval.toolKind === 'workspace_edit' ||
                      approval.toolKind === 'workspace_create'
                    ) {
                      setPendingEditApprovals((prev) => {
                        const existing = prev[key] ?? [];
                        if (
                          existing.some(
                            (e) => e.approvalId === approval.approvalId,
                          )
                        )
                          return prev;
                        return {
                          ...prev,
                          [key]: [
                            ...existing,
                            {
                              approvalId: approval.approvalId,
                              toolCallId: p.toolCallId as string | undefined,
                              action: p.action as 'edit' | 'create',
                              workspaceId: p.workspaceId as string,
                              fileId: p.fileId as string | undefined,
                              file: p.file as string,
                              oldString: p.oldString as string | undefined,
                              newString: p.newString as string | undefined,
                              content: p.content as string | undefined,
                              replaceAll: p.replaceAll as boolean | undefined,
                              occurrences: p.occurrences as number | undefined,
                              workspaceAutoAccept:
                                p.workspaceAutoAccept as boolean,
                              fileAutoAccept: p.fileAutoAccept as number | null,
                              createdAt: p.createdAt as number | undefined,
                              status: 'pending' as const,
                            },
                          ],
                        };
                      });
                    } else if (approval.toolKind === 'skill_edit') {
                      setPendingSkillEditApprovals((prev) => {
                        const existing = prev[key] ?? [];
                        if (
                          existing.some(
                            (e) => e.approvalId === approval.approvalId,
                          )
                        )
                          return prev;
                        return {
                          ...prev,
                          [key]: [
                            ...existing,
                            {
                              approvalId: approval.approvalId,
                              toolCallId: p.toolCallId as string | undefined,
                              action: p.action as
                                | 'create'
                                | 'update'
                                | 'delete',
                              name: p.name as string,
                              oldDescription: p.oldDescription as string,
                              newDescription: p.newDescription as string,
                              oldContent: p.oldContent as string,
                              newContent: p.newContent as string,
                              scope: p.scope as 'global' | 'workspace',
                              workspaceId: p.workspaceId as
                                | string
                                | null
                                | undefined,
                              skillId: p.skillId as string | undefined,
                              createdAt: p.createdAt as number | undefined,
                              status: 'pending' as const,
                            },
                          ],
                        };
                      });
                    } else if (approval.toolKind === 'mcp_tool') {
                      setPendingMcpApprovals((prev) => {
                        const existing = prev[key] ?? [];
                        if (
                          existing.some(
                            (e) => e.approvalId === approval.approvalId,
                          )
                        )
                          return prev;
                        return {
                          ...prev,
                          [key]: [
                            ...existing,
                            {
                              approvalId: approval.approvalId,
                              toolCallId: p.toolCallId as string | undefined,
                              serverId: p.serverId as string | undefined,
                              serverName: p.serverName as string,
                              toolName: p.toolName as string,
                              namespacedName: p.namespacedName as string,
                              description: p.description as string,
                              arguments: (p.arguments ?? {}) as Record<
                                string,
                                unknown
                              >,
                              createdAt: p.createdAt as number | undefined,
                              status: 'pending' as const,
                            },
                          ],
                        };
                      });
                    }
                  }
                },
              )
              .catch(() => {
                // Non-critical: pending prompts can be restored from SSE replay
              });
          }
        },
      );
    } else if (!chatId) {
      setNewChatCreated(true);
      setIsMessagesLoaded(true);
      setChatId(crypto.randomBytes(20).toString('hex'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Remount is now safe (runs persist independently in the RunHub) so the
  // old replaceState hack and both reset effects are no longer needed.

  const isReady = isMessagesLoaded && isConfigReady;

  useEffect(() => {
    if (isReady) console.debug(new Date(), 'app:ready');
  }, [isReady]);

  // Hydrate chartSpecs from message metadata on initial load
  useEffect(() => {
    if (!isMessagesLoaded) return;
    const hydrated: Record<string, Record<string, ChartSpec>> = {};
    for (const msg of messages) {
      const specs = (msg as unknown as Record<string, unknown>).chartSpecs as
        | Record<string, unknown>
        | undefined;
      if (specs && Object.keys(specs).length > 0) {
        const validSpecs: Record<string, ChartSpec> = {};
        for (const [id, spec] of Object.entries(specs)) {
          const result = ChartSpecSchema.safeParse(spec);
          if (result.success) validSpecs[id] = result.data;
        }
        if (Object.keys(validSpecs).length > 0) {
          hydrated[msg.messageId] = validSpecs;
        }
      }
    }
    if (Object.keys(hydrated).length > 0) {
      // Merge persisted specs from loaded messages with any already set live.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setChartSpecsByMessage((prev) => ({ ...hydrated, ...prev }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMessagesLoaded]);

  useEffect(() => {
    refreshEnabledSkills();
  }, [refreshEnabledSkills]);

  const sendMessage = async (
    message: string,
    options?: {
      messageId?: string;
      suggestions?: string[];
      editMode?: boolean;
      images?: ImageAttachment[];
    },
  ) => {
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

    // New chat started on a non-workspace route with a workspace selected: hand
    // the first message off to the workspace's /c/new page so the chat mounts
    // inside the workspace shell immediately (avoids a bare-chat flash before
    // redirecting). The shell-wrapped instance owns the run end-to-end.
    const targetWorkspaceId = workspaceId ?? selectedWorkspaceId;
    if (
      messages.length === 0 &&
      !workspaceId &&
      targetWorkspaceId &&
      !options?.editMode &&
      !options?.messageId
    ) {
      const deferredImages =
        options?.images !== undefined
          ? options.images.length > 0
            ? options.images
            : undefined
          : pendingImages.length > 0
            ? [...pendingImages]
            : undefined;
      pendingWorkspaceFirstSend = { message, images: deferredImages };
      router.replace(`/workspaces/${targetWorkspaceId}/c/new`);
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

    const msgInvokedSkills: string[] = [];
    for (const m of message.matchAll(SKILL_TOKEN_SCAN_REGEX)) {
      const name = m[1];
      if (enabledUserSkillNames.has(name) && !msgInvokedSkills.includes(name)) {
        msgInvokedSkills.push(name);
      }
    }

    setMessages((prevMessages) => [
      ...prevMessages,
      {
        content: message,
        messageId: messageId,
        chatId: chatId!,
        role: 'user',
        createdAt: new Date(),
        ...(messageImages && { images: messageImages }),
        ...(msgInvokedSkills.length > 0 && { invokedSkills: msgInvokedSkills }),
      },
    ]);

    setPendingImages([]);

    // If this is a new chat (no chatId in URL), replace the URL to include the
    // new chatId. Use history.replaceState rather than router.replace: a real
    // route navigation would unmount this streaming ChatWindow and mount a
    // fresh one (different page component + key) that reloads from the DB,
    // making the chat content visibly disappear and re-render mid-stream. Next
    // syncs usePathname/useSearchParams from history.replaceState, so the URL
    // updates in place while this instance keeps streaming uninterrupted.
    if (messages.length <= 1) {
      const wsId = workspaceId ?? selectedWorkspaceId;
      const newUrl = wsId ? `/workspaces/${wsId}/c/${chatId}` : `/c/${chatId}`;
      window.history.replaceState(null, '', newUrl);
      // loadMessages normally sets the tab title on mount; since we no longer
      // remount, set it here for the freshly-titled chat.
      document.title = message;
      // The chat row is created server-side on this first message; invalidate
      // the cached chat lists so history/sidebar show it instead of waiting out
      // the default staleTime.
      queryClient.invalidateQueries({ queryKey: qk.chatsRoot });
    }

    // Optimistically register this run in the active-runs cache. While this
    // chat stays open the entry is the foreground run and is filtered out of
    // the sidebar's in-progress flare; the moment the user navigates away it
    // becomes a backgrounded run, so seeding it here lets the flare surface
    // immediately instead of waiting for the next poll/refetch round-trip.
    queryClient.setQueryData<ActiveRunsData>(qk.activeRuns, (old) => {
      const base = old ?? {
        active: [],
        stale: [],
        unreadCount: 0,
        awaitingAttentionCount: 0,
      };
      if (base.active.some((r) => r.chatId === chatId)) return base;
      return {
        ...base,
        active: [
          ...base.active,
          {
            chatId: chatId!,
            messageId,
            startedAt: Date.now(),
            status: 'running' as const,
          },
        ],
      };
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const messageHandler = async (data: Record<string, any>) => {
      if (data.type === 'error') {
        toast.error(data.data);
        setLoading(false);
        // The run is terminal (errored/cancelled) — drop the optimistic
        // active-runs entry so a finished run can't linger as a false flare.
        queryClient.invalidateQueries({ queryKey: qk.activeRuns });
        // The run is terminal (errored/cancelled) — dismiss any open approval
        // prompts so they don't linger on this or other attached tabs.
        setPendingQuestions({});
        setPendingExecutions({});
        setPendingEditApprovals({});
        setPendingSkillEditApprovals({});
        setPendingMcpApprovals({});
        return;
      }

      // Per-tool *_cancelled events close the specific modal on all tabs
      // when the user clicks Stop while a run is paused at an interrupt.
      if (data.type?.endsWith('_cancelled') && !data.type.endsWith('_stale')) {
        const cancelledApprovalId = data.data?.approvalId as string | undefined;
        if (cancelledApprovalId) {
          setPendingQuestions((prev) => {
            const updated: Record<string, PendingQuestion[]> = {};
            for (const [msgId, items] of Object.entries(prev)) {
              updated[msgId] = items.map((q) =>
                q.questionId === cancelledApprovalId
                  ? { ...q, status: 'cancelled' as const }
                  : q,
              );
            }
            return updated;
          });
          setPendingExecutions((prev) => {
            const updated: Record<string, PendingExecution[]> = {};
            for (const [msgId, items] of Object.entries(prev)) {
              updated[msgId] = items.map((e) =>
                e.executionId === cancelledApprovalId
                  ? { ...e, status: 'cancelled' as const }
                  : e,
              );
            }
            return updated;
          });
          setPendingEditApprovals((prev) => {
            const updated: Record<string, PendingEditApproval[]> = {};
            for (const [msgId, items] of Object.entries(prev)) {
              updated[msgId] = items.map((a) =>
                a.approvalId === cancelledApprovalId
                  ? { ...a, status: 'cancelled' as const }
                  : a,
              );
            }
            return updated;
          });
          setPendingSkillEditApprovals((prev) => {
            const updated: Record<string, PendingSkillEditApproval[]> = {};
            for (const [msgId, items] of Object.entries(prev)) {
              updated[msgId] = items.map((a) =>
                a.approvalId === cancelledApprovalId
                  ? { ...a, status: 'cancelled' as const }
                  : a,
              );
            }
            return updated;
          });
          setPendingMcpApprovals((prev) => {
            const updated: Record<string, PendingMcpApproval[]> = {};
            for (const [msgId, items] of Object.entries(prev)) {
              updated[msgId] = items.map((a) =>
                a.approvalId === cancelledApprovalId
                  ? { ...a, status: 'cancelled' as const }
                  : a,
              );
            }
            return updated;
          });
        }
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
      if (data.type === 'context_grew') {
        // Live inflation signal: bump the most recent prior message's stats
        // so the context-usage chip reflects newly persisted tool output
        // before the turn ends.
        setLiveContextGrew({
          kind: data.kind,
          tokens: data.tokens,
          totalEstimated: data.totalEstimated,
          at: Date.now(),
        });
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
        const transform = (content: string): string => {
          if (nestedEvent?.type === 'response') {
            return applySubagentResponseToken(
              content,
              executionId,
              nestedEvent.data || '',
            );
          }
          if (nestedEvent?.type?.startsWith('tool_call')) {
            return applySubagentNestedToolCall(
              content,
              executionId,
              nestedEvent,
            );
          }
          return content;
        };
        setMessages((prev) =>
          prev.map((message) =>
            message.messageId === data.messageId
              ? { ...message, content: transform(message.content) }
              : message,
          ),
        );
        setScrollTrigger((prev) => prev + 1);
        return;
      }

      // Handle subagent completion or error
      if (
        data.type === 'subagent_completed' ||
        data.type === 'subagent_error'
      ) {
        const status = data.type === 'subagent_completed' ? 'success' : 'error';
        const executionId = data.id;

        setMessages((prev) =>
          prev.map((message) =>
            message.messageId === data.messageId
              ? {
                  ...message,
                  content: applySubagentStatus(
                    message.content,
                    executionId,
                    status,
                    data.summary,
                    data.error,
                  ),
                }
              : message,
          ),
        );

        recievedMessage = applySubagentStatus(
          recievedMessage,
          executionId,
          status,
          data.summary,
          data.error,
        );

        setScrollTrigger((prev) => prev + 1);
        return;
      }

      // Agent panel executor lifecycle (live stream).
      if (
        data.type === 'panel_executor_started' ||
        data.type === 'panel_executor_data' ||
        data.type === 'panel_executor_completed' ||
        data.type === 'panel_executor_error'
      ) {
        const idx = data.executorIdx as number;
        const transform = (content: string): string => {
          if (data.type === 'panel_executor_started') {
            return applyPanelExecutorStarted(
              content,
              idx,
              data.model ?? `Model ${idx + 1}`,
            );
          }
          if (data.type === 'panel_executor_data') {
            return applyPanelExecutorResponseToken(
              content,
              idx,
              data.token ?? '',
            );
          }
          if (data.type === 'panel_executor_completed') {
            return applyPanelExecutorStatus(content, idx, 'success', {
              sourceCount: data.sourceCount,
              tokens: panelExecutorTokens(data.usage),
              model: data.model,
            });
          }
          return applyPanelExecutorStatus(content, idx, 'error', {
            error: data.error,
            model: data.model,
          });
        };

        if (!added) {
          recievedMessage = transform('');
          setMessages((prevMessages) => [
            ...prevMessages,
            {
              content: recievedMessage,
              messageId: data.messageId || 'temp',
              chatId: chatId!,
              role: 'assistant',
              sources: sources,
              createdAt: new Date(),
            },
          ]);
          added = true;
        } else {
          recievedMessage = transform(recievedMessage);
          setMessages((prev) =>
            prev.map((message) =>
              message.messageId === data.messageId
                ? { ...message, content: transform(message.content) }
                : message,
            ),
          );
        }
        setScrollTrigger((prev) => prev + 1);
        return;
      }

      if (data.type === 'code_execution_pending') {
        // executionId is the approvalId in the interrupt-based flow
        const executionId = data.data?.approvalId ?? data.data?.executionId;
        const runId = data.data?.markupToolCallId;
        if (runId && executionId) {
          codeExecutionRunIdMap.set(executionId, runId);
        }
        // The completion event (code_execution_result) carries only toolCallId,
        // not the approvalId, so also key the markup correlation on toolCallId.
        if (runId && data.data?.toolCallId) {
          codeExecutionRunIdMap.set(data.data.toolCallId, runId);
        }
        setPendingExecutions((prev) => ({
          ...prev,
          [data.messageId]: [
            ...(prev[data.messageId] ?? []),
            {
              executionId,
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

      if (data.type === 'code_execution_answered') {
        // Multi-tab: close the approval modal when another tab already answered.
        // The approvalId doubles as the executionId in the interrupt-based flow.
        const answeredExecId = data.data?.approvalId ?? data.data?.executionId;
        const approved = (data.data?.response as Record<string, unknown>)
          ?.approved;
        if (answeredExecId) {
          setPendingExecutions((prev) => {
            const updated: Record<string, PendingExecution[]> = {};
            for (const [msgId, executions] of Object.entries(prev)) {
              updated[msgId] = executions.map((e) =>
                e.executionId === answeredExecId
                  ? {
                      ...e,
                      status: (approved === false ? 'denied' : 'approved') as
                        | 'approved'
                        | 'denied',
                    }
                  : e,
              );
            }
            return updated;
          });
        }
        return;
      }

      // Stale-snapshot events: the resume endpoint detected that external state
      // changed while paused (file sha / skill content). The run continues — the
      // agent re-checks and retries on its own — so close the affected modal and
      // let the user know what happened.
      if (data.type?.endsWith('_stale')) {
        const approvalId = data.data?.approvalId as string | undefined;
        const reason = data.data?.reason as string | undefined;
        toast.error(
          reason
            ? `${reason} The assistant will re-check and try again.`
            : 'The target changed while awaiting approval; the assistant will re-check and try again.',
        );
        if (approvalId) {
          setPendingEditApprovals((prev) => {
            const updated: Record<string, PendingEditApproval[]> = {};
            for (const [msgId, items] of Object.entries(prev)) {
              updated[msgId] = items.map((a) =>
                a.approvalId === approvalId
                  ? { ...a, status: 'cancelled' as const }
                  : a,
              );
            }
            return updated;
          });
          setPendingSkillEditApprovals((prev) => {
            const updated: Record<string, PendingSkillEditApproval[]> = {};
            for (const [msgId, items] of Object.entries(prev)) {
              updated[msgId] = items.map((a) =>
                a.approvalId === approvalId
                  ? { ...a, status: 'cancelled' as const }
                  : a,
              );
            }
            return updated;
          });
          setPendingMcpApprovals((prev) => {
            const updated: Record<string, PendingMcpApproval[]> = {};
            for (const [msgId, items] of Object.entries(prev)) {
              updated[msgId] = items.map((a) =>
                a.approvalId === approvalId
                  ? { ...a, status: 'cancelled' as const }
                  : a,
              );
            }
            return updated;
          });
          setPendingQuestions((prev) => {
            const updated: Record<string, PendingQuestion[]> = {};
            for (const [msgId, items] of Object.entries(prev)) {
              updated[msgId] = items.map((q) =>
                q.questionId === approvalId
                  ? { ...q, status: 'cancelled' as const }
                  : q,
              );
            }
            return updated;
          });
        }
        return;
      }

      if (data.type === 'code_execution_result') {
        setPendingExecutions((prev) => ({
          ...prev,
          [data.messageId]: (prev[data.messageId] ?? []).map((execution) =>
            (data.data.executionId &&
              execution.executionId === data.data.executionId) ||
            (data.data.toolCallId &&
              execution.toolCallId === data.data.toolCallId)
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
          codeExecutionRunIdMap.get(data.data.toolCallId) ||
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

      if (
        data.type === 'user_question_pending' ||
        data.type === 'ask_user_pending'
      ) {
        const runId = data.data?.markupToolCallId;
        // New interrupt-based flow uses approvalId; legacy flow used questionId
        const questionId = data.data?.approvalId ?? data.data?.questionId;
        if (runId && questionId) {
          userQuestionRunIdMap.set(questionId, runId);
        }
        setPendingQuestions((prev) => ({
          ...prev,
          [data.messageId]: [
            ...(prev[data.messageId] ?? []),
            {
              questionId,
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

      if (
        data.type === 'user_question_answered' ||
        data.type === 'ask_user_answered'
      ) {
        const answeredId = data.data?.approvalId ?? data.data?.questionId;
        setPendingQuestions((prev) => ({
          ...prev,
          [data.messageId]: (prev[data.messageId] ?? []).map((q) =>
            q.questionId === answeredId
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
          userQuestionRunIdMap.get(answeredId) || data.data.toolCallId;
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

      // Handle chart spec events
      if (data.type === 'chart_spec') {
        const { chartId, spec } = data.data;
        if (chartId && spec) {
          setChartSpecsByMessage((prev) => ({
            ...prev,
            [data.messageId]: {
              ...(prev[data.messageId] ?? {}),
              [chartId]: spec,
            },
          }));
        }
        return;
      }

      // Handle todo list updates
      if (data.type === 'todo_update') {
        setTodoItems(data.data.todos || []);
        return;
      }

      if (
        data.type === 'workspace_edit_approval_pending' ||
        data.type === 'workspace_edit_pending' ||
        data.type === 'workspace_create_pending'
      ) {
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

      if (
        data.type === 'workspace_edit_approval_answered' ||
        data.type === 'workspace_edit_answered' ||
        data.type === 'workspace_create_answered'
      ) {
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
        queryClient.invalidateQueries({
          queryKey: ['workspaces', data.data.workspaceId],
        });
        return;
      }

      if (
        data.type === 'skill_edit_approval_pending' ||
        data.type === 'skill_edit_pending'
      ) {
        setPendingSkillEditApprovals((prev) => ({
          ...prev,
          [data.messageId]: [
            ...(prev[data.messageId] ?? []),
            {
              approvalId: data.data.approvalId,
              toolCallId: data.data.toolCallId,
              action: data.data.action,
              name: data.data.name,
              oldDescription: data.data.oldDescription,
              newDescription: data.data.newDescription,
              oldContent: data.data.oldContent,
              newContent: data.data.newContent,
              scope: data.data.scope,
              workspaceId: data.data.workspaceId,
              skillId: data.data.skillId,
              createdAt: data.data.createdAt,
              status: 'pending' as const,
            },
          ],
        }));
        setScrollTrigger((prev) => prev + 1);
        return;
      }

      if (
        data.type === 'skill_edit_approval_answered' ||
        data.type === 'skill_edit_answered'
      ) {
        setPendingSkillEditApprovals((prev) => ({
          ...prev,
          [data.messageId]: (prev[data.messageId] ?? []).map((a) =>
            a.approvalId === data.data.approvalId
              ? {
                  ...a,
                  status: (data.data.decision === 'reject'
                    ? 'rejected'
                    : 'accepted') as 'accepted' | 'rejected',
                }
              : a,
          ),
        }));
        // Refresh autocomplete on accepted edits so newly created/updated skills appear
        if (
          data.data.decision !== 'reject' &&
          data.data.decision !== 'always_prompt' &&
          !data.data.timedOut
        ) {
          refreshEnabledSkills();
        }
        return;
      }

      if (data.type === 'mcp_tool_pending') {
        setPendingMcpApprovals((prev) => {
          const existing = prev[data.messageId] ?? [];
          if (existing.some((a) => a.approvalId === data.data.approvalId))
            return prev;
          return {
            ...prev,
            [data.messageId]: [
              ...existing,
              {
                approvalId: data.data.approvalId,
                toolCallId: data.data.toolCallId,
                serverId: data.data.serverId,
                serverName: data.data.serverName,
                toolName: data.data.toolName,
                namespacedName: data.data.namespacedName,
                description: data.data.description,
                arguments: data.data.arguments ?? {},
                createdAt: data.data.createdAt,
                status: 'pending' as const,
              },
            ],
          };
        });
        setScrollTrigger((prev) => prev + 1);
        return;
      }

      if (data.type === 'mcp_tool_answered') {
        setPendingMcpApprovals((prev) => ({
          ...prev,
          [data.messageId]: (prev[data.messageId] ?? []).map((a) =>
            a.approvalId === data.data.approvalId
              ? {
                  ...a,
                  status: (data.data.response?.approved === false
                    ? 'denied'
                    : 'approved') as 'approved' | 'denied',
                }
              : a,
          ),
        }));
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
        setLiveContextGrew(null);
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
                    ...(typeof data.projectedNextInputTokens === 'number'
                      ? {
                          projectedNextInputTokens:
                            data.projectedNextInputTokens,
                        }
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
        // Run finished — reconcile the active-runs cache so the optimistic
        // entry seeded at send time clears immediately (otherwise navigating
        // away right after completion could flash a stale in-progress flare).
        queryClient.invalidateQueries({ queryKey: qk.activeRuns });

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
      localStorage.getItem('contextWindowSize') ||
        String(DEFAULT_CONTEXT_WINDOW),
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

    // Personalization (userLocation/userProfile) and memory toggles are
    // server-authoritative: the /api/chat route reads them from the DB
    // (app_settings) so they are no longer sent from the client.

    if (isPrivateSession) {
      payload.isPrivate = true;
    }

    if (selectedWorkspaceId) {
      payload.workspaceId = selectedWorkspaceId;
    }

    if (imageCapable) {
      payload.imageCapable = true;
    }

    if (msgInvokedSkills.length > 0) {
      payload.invokedSkills = msgInvokedSkills;
    }

    // Agent panel: when enabled (and the focus mode supports research), fan the
    // turn out across the selected executor models; the chat model synthesizes.
    if (focusMode === 'webSearch' || focusMode === 'localResearch') {
      try {
        const raw = localStorage.getItem(PANEL_SELECTION_KEY);
        if (raw) {
          const sel = JSON.parse(raw) as PanelSelection;
          if (Array.isArray(sel?.executors) && isPanelSelectionReady(sel)) {
            payload.panel = { executors: sel.executors };
          }
        }
      } catch {
        // ignore malformed panel selection
      }
    }

    streamAbortRef.current?.abort();
    const abortController = new AbortController();
    streamAbortRef.current = abortController;

    let res: Response;
    try {
      res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: abortController.signal,
      });
    } catch (err) {
      // Aborted on unmount/navigation — run continues server-side.
      if (err instanceof DOMException && err.name === 'AbortError') return;
      throw err;
    }

    if (!res.body) throw new Error('No response body');

    await readStream(res.body.getReader(), messageHandler);
    // Stream finished normally — drop the (now-complete) controller so a later
    // tab-hide doesn't mistake this dead controller for an in-flight run and
    // trigger a needless reload + mark-seen on return. Guard against a newer
    // send having already replaced it.
    if (streamAbortRef.current === abortController) {
      streamAbortRef.current = null;
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

      // Apply saved chat model if valid. One-shot setup before auto-sending the
      // initial query; the synchronous setState here is intentional.
      if (searchChatModelProvider && searchChatModel) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
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

  // Pick up a first message handed off from the home route (see
  // pendingWorkspaceFirstSend) once this shell-wrapped /c/new instance is ready.
  useEffect(() => {
    if (isReady && isConfigReady && pendingWorkspaceFirstSend) {
      const pending = pendingWorkspaceFirstSend;
      pendingWorkspaceFirstSend = null;
      // One-shot auto-send of the handed-off message, mirroring the initial
      // query effect above.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      sendMessage(
        pending.message,
        pending.images ? { images: pending.images } : undefined,
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfigReady, isReady]);

  // Build a flat chartId → spec map for ChartSpecContext (must be before any early returns)
  const flatChartSpecs = useMemo(() => {
    const flat: Record<string, ChartSpec> = {};
    for (const specs of Object.values(chartSpecsByMessage)) {
      Object.assign(flat, specs);
    }
    return flat;
  }, [chartSpecsByMessage]);

  const chartSpecContextValue = useMemo(
    () => ({
      getChartSpec: (id: string) => {
        const direct = flatChartSpecs[id];
        if (direct) return direct;
        // Fallback: models sometimes emit the chart's title as the id
        // instead of its UUID. Match on title so the chart still renders.
        return Object.values(flatChartSpecs).find((s) => s.title === id);
      },
    }),
    [flatChartSpecs],
  );

  if (hasError) {
    return (
      <div className="relative">
        <div className="absolute w-full flex flex-row items-center justify-end mr-5 mt-5">
          <button
            type="button"
            onClick={() => openSettings()}
            aria-label="Settings"
          >
            <Settings className="cursor-pointer lg:hidden" />
          </button>
        </div>
        <div className="flex flex-col items-center justify-center min-h-screen">
          <p className="text-sm">
            Failed to connect to the server. Please try again later.
          </p>
        </div>
      </div>
    );
  }

  // Context usage chip: reflects estimated tokens that will be sent on the
  // next model call. Priority order:
  //   1. During a turn: liveModelStats.firstChatCallInputTokens (actual
  //      measured input for this turn's first LLM call) + liveAdd (context_grew
  //      inflation from tools that have already persisted rows this turn).
  //   2. After a turn: projectedNextInputTokens from the most recent completed
  //      assistant message — server-computed sum of all persisted rows + a
  //      fixed system-prompt estimate. This is the baseline for the next turn.
  //   3. Old messages (pre-dating projectedNextInputTokens): fall back to
  //      firstChatCallInputTokens + output length estimate.
  //   4. No modelStats at all: rough character-count estimate.
  // liveAdd is added in every case so context_grew events update the chip live.
  const contextUsage = (() => {
    const liveAdd = liveContextGrew?.totalEstimated ?? 0;

    // During a turn the stats event fires before messageEnd and sets
    // liveModelStats.firstChatCallInputTokens — use it as the live baseline.
    if (liveModelStats?.firstChatCallInputTokens) {
      return liveModelStats.firstChatCallInputTokens + liveAdd;
    }

    // After a turn, prefer projectedNextInputTokens (accounts for system rows
    // persisted this turn). Fall back to firstChatCallInputTokens for old
    // messages that predate this field.
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      // A compaction replaces everything before it, so if it's the most recent
      // entry (no turns since) its post-compaction estimate is the live usage.
      if (msg.role === 'compaction' && msg.compaction?.tokensAfter) {
        return msg.compaction.tokensAfter + liveAdd;
      }
      const stats = msg.modelStats;
      if (stats?.projectedNextInputTokens) {
        return stats.projectedNextInputTokens + liveAdd;
      }
      if (stats?.firstChatCallInputTokens) {
        const outputEstimate = Math.round((msg.content?.length || 0) / 4);
        return stats.firstChatCallInputTokens + outputEstimate + liveAdd;
      }
    }
    // Fallback: estimate from all message content
    const contentChars = messages.reduce(
      (sum, m) => sum + (m.content?.length || 0),
      0,
    );
    return Math.round(contentChars / 4) + 3000 + liveAdd;
  })();

  const handleCompact = async (instructions?: string) => {
    if (!chatId || compacting) return;
    setCompacting(true);
    try {
      const contextWindowSize = parseInt(
        localStorage.getItem('contextWindowSize') ||
          String(DEFAULT_CONTEXT_WINDOW),
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

  return (
    <ChartSpecContext.Provider value={chartSpecContextValue}>
      {isReady ? (
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
                  skillNames={enabledUserSkillNames}
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
                  onExecutionAction={(
                    executionId: string,
                    approved: boolean,
                  ) => {
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
                      const res = await fetch('/api/chat/runs/resume', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          approvalId: questionId,
                          response,
                        }),
                      });
                      if (!res.ok) throw new Error(`HTTP ${res.status}`);
                      reattachToActiveRun();
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
                      const res = await fetch('/api/chat/runs/resume', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          approvalId: questionId,
                          response: { skipped: true },
                        }),
                      });
                      if (!res.ok) throw new Error(`HTTP ${res.status}`);
                      reattachToActiveRun();
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
                    try {
                      const res = await fetch('/api/chat/runs/resume', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          approvalId,
                          response: { decision, freeformText },
                        }),
                      });
                      if (!res.ok) throw new Error(`HTTP ${res.status}`);
                      reattachToActiveRun();
                    } catch {
                      toast.error(
                        'Failed to send edit decision. The agent will continue on its own.',
                      );
                    }
                  }}
                  pendingSkillEditApprovals={pendingSkillEditApprovals}
                  onSkillEditDecide={async (
                    approvalId: string,
                    decision: 'accept' | 'reject',
                    freeformText?: string,
                  ) => {
                    setPendingSkillEditApprovals((prev) => {
                      const updated: Record<
                        string,
                        PendingSkillEditApproval[]
                      > = {};
                      for (const [msgId, approvals] of Object.entries(prev)) {
                        updated[msgId] = approvals.map((a) =>
                          a.approvalId === approvalId
                            ? {
                                ...a,
                                status: (decision === 'reject'
                                  ? 'rejected'
                                  : 'accepted') as 'accepted' | 'rejected',
                              }
                            : a,
                        );
                      }
                      return updated;
                    });
                    try {
                      const res = await fetch('/api/chat/runs/resume', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          approvalId,
                          response: { decision, freeformText },
                        }),
                      });
                      if (!res.ok) throw new Error(`HTTP ${res.status}`);
                      reattachToActiveRun();
                    } catch {
                      toast.error(
                        'Failed to send skill edit decision. The agent will continue on its own.',
                      );
                    }
                  }}
                  pendingMcpApprovals={pendingMcpApprovals}
                  onMcpToolDecide={async (
                    approvalId: string,
                    approved: boolean,
                    opts?: { alwaysAllow?: boolean },
                  ) => {
                    // Capture the target tool before we mutate state, so the
                    // "Always allow" write-through knows which server/tool to flip.
                    const target = Object.values(pendingMcpApprovals)
                      .flat()
                      .find((a) => a.approvalId === approvalId);
                    setPendingMcpApprovals((prev) => {
                      const updated: Record<string, PendingMcpApproval[]> = {};
                      for (const [msgId, approvals] of Object.entries(prev)) {
                        updated[msgId] = approvals.map((a) =>
                          a.approvalId === approvalId
                            ? {
                                ...a,
                                status: (approved ? 'approved' : 'denied') as
                                  | 'approved'
                                  | 'denied',
                              }
                            : a,
                        );
                      }
                      return updated;
                    });
                    // Persist auto-run for this tool (best-effort, non-blocking).
                    if (
                      opts?.alwaysAllow &&
                      approved &&
                      target?.serverId &&
                      target.toolName
                    ) {
                      void persistMcpAlwaysAllow(
                        target.serverId,
                        target.toolName,
                      );
                    }
                    try {
                      const res = await fetch('/api/chat/runs/resume', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          approvalId,
                          response: { approved },
                        }),
                      });
                      if (!res.ok) throw new Error(`HTTP ${res.status}`);
                      reattachToActiveRun();
                    } catch {
                      toast.error(
                        'Failed to send MCP tool decision. The agent will continue on its own.',
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
                  enabledSkills={enabledSkillsForAutocomplete}
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
                enabledSkills={enabledSkillsForAutocomplete}
              />
            )}
          </div>
        )
      ) : (
        <div className="flex flex-row items-center justify-center min-h-screen">
          <LoaderCircle size={32} className="animate-spin text-accent" />
        </div>
      )}
    </ChartSpecContext.Provider>
  );
};

export default ChatWindow;
