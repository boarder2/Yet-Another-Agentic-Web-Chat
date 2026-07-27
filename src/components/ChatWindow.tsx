'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
} from 'react';
import {
  reduceStreamEvent,
  initialChatStreamState,
  type ChatStreamState,
  type StreamAction,
} from '@/lib/streaming/reducer';
import {
  normalizeStreamEvent,
  type UnknownStreamEvent,
} from '@/lib/streaming/events';
import type { StreamEffect } from '@/lib/streaming/effects';
import type {
  Message,
  File,
  ImageAttachment,
  PendingExecution,
  PendingQuestion,
  PendingEditApproval,
  PendingSkillEditApproval,
  PendingMcpApproval,
} from '@/lib/streaming/chatState';
// The chat message vocabulary is defined once in the streaming module; re-export
// the app-facing types so existing `@/components/ChatWindow` importers resolve.
export type {
  Message,
  File,
  ImageAttachment,
  ModelStats,
  TokenUsage,
  CompactionData,
} from '@/lib/streaming/chatState';
import {
  PANEL_SELECTION_KEY,
  isPanelSelectionReady,
  type PanelSelection,
} from '@/lib/panel/panelSelection';
import { ChartSpecContext } from '@/lib/chart/ChartSpecContext';
import { ChartSpec, ChartSpecSchema } from '@/lib/chart/chartSpec';
import ChatActions from './ChatActions';
import Chat from './Chat';
import EmptyChat from './EmptyChat';
import crypto from 'crypto';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { qk } from '@/lib/api/keys';
import { apiFetch } from '@/lib/api/client';
import type { ActiveRunsData } from '@/lib/hooks/api/useActiveRuns';
import { useMarkChatSeen } from '@/lib/hooks/api/useActiveRuns';
import { useSkills } from '@/lib/hooks/api/useSkills';
import { useSearchParams, useRouter } from 'next/navigation';
import { getSuggestions } from '@/lib/actions';
import { SKILL_TOKEN_SCAN_REGEX } from '@/lib/skills/validation';
import { LoaderCircle, Settings } from 'lucide-react';
import { useSettingsModal } from '@/components/settings/SettingsModalProvider';
import { subscribeSettingsHydrated } from '@/lib/settings/persist';
import NextError from 'next/error';
import {
  useLocalStorageBoolean,
  useLocalStorageString,
} from '@/lib/hooks/useLocalStorage';
import { DEFAULT_CONTEXT_WINDOW } from '@/lib/models/presets';

interface ChatModelProvider {
  name: string;
  provider: string;
}

const SEND_LOCATION_KEY = 'personalization.sendLocationEnabled';
const SEND_PROFILE_KEY = 'personalization.sendProfileEnabled';

const checkConfig = async (
  setChatModelProvider: (provider: ChatModelProvider) => void,
  setIsConfigReady: (ready: boolean) => void,
  setHasError: (hasError: boolean) => void,
  onOpenApiKeys: () => void,
) => {
  try {
    let chatModel = localStorage.getItem('chatModel');
    let chatModelProvider = localStorage.getItem('chatModelProvider');

    const providers = await fetch(`/api/models`, {
      headers: { 'Content-Type': 'application/json' },
    }).then(async (res) => {
      if (!res.ok)
        throw new Error(
          `Failed to fetch models: ${res.status} ${res.statusText}`,
        );
      return res.json();
    });

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

      localStorage.setItem('chatModel', chatModel!);
      localStorage.setItem('chatModelProvider', chatModelProvider!);
    } else {
      const chatModelProviders = providers.chatModelProviders;

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
    }

    setChatModelProvider({
      name: chatModel!,
      provider: chatModelProvider!,
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
  setTitle?: (title: string) => void,
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

  // The DB title is authoritative (auto-generated or renamed); fall back to the
  // first message only for a title-less legacy row.
  const chatTitle = data.chat.title || messages[0]?.content || '';
  if (setTitle) setTitle(chatTitle);
  document.title = chatTitle;

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

// Fields of ChatStreamState that affect what is rendered. A reducer transition
// that touches none of these (response-token and nested widget-token buffering)
// skips the re-render, matching the old handler's every-5-tokens commit cadence.
const RENDER_KEYS = [
  'messages',
  'liveModelStats',
  'liveContextGrew',
  'gatheringSources',
  'todoItems',
  'pendingExecutions',
  'pendingQuestions',
  'pendingEditApprovals',
  'pendingSkillEditApprovals',
  'pendingMcpApprovals',
  'chartSpecsByMessage',
] as const satisfies readonly (keyof ChatStreamState)[];

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
  // Single source of truth for the chat title (DB `chats.title`). Drives the tab
  // title, the in-chat header, and export filenames; updated live by the
  // auto-title `setChatTitle` effect and by manual rename.
  const [title, setTitle] = useState('');

  const [chatModelProvider, setChatModelProvider] = useState<ChatModelProvider>(
    {
      name: '',
      provider: '',
    },
  );

  // Note: embedding and system models are only selectable in Settings (the
  // embedding model is a system-level setting resolved server-side from the DB);
  // we read the chat model from localStorage at send time.

  const [isConfigReady, setIsConfigReady] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    // checkConfig treats a missing chatModel/chatModelProvider in localStorage
    // as "unconfigured" and picks a fallback provider, persisting it back. Until
    // DB→localStorage hydration completes, an empty cache doesn't mean
    // unconfigured — it means not-yet-synced — so wait for hydration first;
    // otherwise this races hydrateSettingsFromDb and can permanently overwrite
    // the real selection with the wrong fallback.
    return subscribeSettingsHydrated(() => {
      checkConfig(setChatModelProvider, setIsConfigReady, setHasError, () =>
        openSettings('api-keys'),
      );
    });
  }, [openSettings]);

  const [loading, setLoading] = useState(false);
  const [scrollTrigger, setScrollTrigger] = useState(0);

  // Consolidated stream state: one reducer transition per wire event, shared by
  // the live-send and reconnect/attach paths. `streamStateRef` is the
  // synchronous source of truth (the async stream loop reads it between
  // dispatches); `streamState` mirrors it for rendering.
  const [streamState, setStreamState] = useState<ChatStreamState>(
    initialChatStreamState,
  );
  const streamStateRef = useRef<ChatStreamState>(streamState);

  const applyStreamState = useCallback(
    (updater: (prev: ChatStreamState) => ChatStreamState) => {
      const next = updater(streamStateRef.current);
      streamStateRef.current = next;
      setStreamState(next);
    },
    [],
  );
  // Field-level setter that keeps the ref and rendered state in lock-step, so
  // the non-stream callers (initial load, seeds, optimistic approval answers)
  // can update one slice of stream state with the familiar setState signature.
  const setField = useCallback(
    <K extends keyof ChatStreamState>(
      key: K,
      value: SetStateAction<ChatStreamState[K]>,
    ) =>
      applyStreamState((s) => ({
        ...s,
        [key]:
          typeof value === 'function'
            ? (value as (p: ChatStreamState[K]) => ChatStreamState[K])(s[key])
            : value,
      })),
    [applyStreamState],
  );

  const {
    messages,
    liveModelStats,
    liveContextGrew,
    gatheringSources,
    todoItems,
    pendingExecutions,
    pendingQuestions,
    pendingEditApprovals,
    pendingSkillEditApprovals,
    pendingMcpApprovals,
    chartSpecsByMessage,
  } = streamState;

  // Non-stream message writes (initial load, rewrite/delete, suggestions) fold
  // through the reducer's `set_messages` action, keeping one write path for the
  // consolidated messages slice.
  const setMessages = useCallback(
    (v: SetStateAction<Message[]>) =>
      applyStreamState(
        (s) =>
          reduceStreamEvent(s, {
            type: 'set_messages',
            updater:
              typeof v === 'function'
                ? (v as (prev: Message[]) => Message[])
                : () => v,
          }).state,
      ),
    [applyStreamState],
  );
  const setPendingExecutions = (
    v: SetStateAction<Record<string, PendingExecution[]>>,
  ) => setField('pendingExecutions', v);
  const setPendingQuestions = (
    v: SetStateAction<Record<string, PendingQuestion[]>>,
  ) => setField('pendingQuestions', v);
  const setPendingEditApprovals = (
    v: SetStateAction<Record<string, PendingEditApproval[]>>,
  ) => setField('pendingEditApprovals', v);
  const setPendingSkillEditApprovals = (
    v: SetStateAction<Record<string, PendingSkillEditApproval[]>>,
  ) => setField('pendingSkillEditApprovals', v);
  const setPendingMcpApprovals = (
    v: SetStateAction<Record<string, PendingMcpApproval[]>>,
  ) => setField('pendingMcpApprovals', v);
  const setChartSpecsByMessage = (
    v: SetStateAction<Record<string, Record<string, ChartSpec>>>,
  ) => setField('chartSpecsByMessage', v);

  const [compacting, setCompacting] = useState(false);

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

  // Enabled user skills for slash-command invocation and autocomplete
  const { data: enabledSkills = [] } = useSkills(selectedWorkspaceId, true);
  const enabledUserSkillNames = useMemo(
    () => new Set(enabledSkills.map((s) => s.name)),
    [enabledSkills],
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

  // messageEnd asks (via a fetchSuggestions effect) for follow-up suggestions on
  // a completed, sourced answer that has none yet.
  const fetchSuggestions = async (messageId: string) => {
    if (localStorage.getItem('autoSuggestions') === 'false') return;
    const msgs = streamStateRef.current.messages;
    const target = msgs.find((m) => m.messageId === messageId);
    if (
      target?.role === 'assistant' &&
      target.sources &&
      target.sources.length > 0 &&
      !target.suggestions
    ) {
      const suggestions = await getSuggestions(msgs);
      setMessages((prev) =>
        prev.map((m) =>
          m.messageId === messageId ? { ...m, suggestions } : m,
        ),
      );
    }
  };

  // Interpret one reducer effect. The reducer stays pure; every side effect it
  // requests is performed here.
  const runEffect = (effect: StreamEffect) => {
    switch (effect.kind) {
      case 'toastError':
        toast.error(effect.message);
        break;
      case 'setLoading':
        setLoading(effect.value);
        break;
      case 'bumpScroll':
        setScrollTrigger((prev) => prev + 1);
        break;
      case 'invalidateActiveRuns':
        queryClient.invalidateQueries({ queryKey: qk.activeRuns });
        break;
      case 'invalidateWorkspace':
        queryClient.invalidateQueries({
          queryKey: ['workspaces', effect.workspaceId],
        });
        break;
      case 'refreshSkills':
        queryClient.invalidateQueries({ queryKey: qk.skillsRoot });
        break;
      case 'fetchSuggestions':
        void fetchSuggestions(effect.messageId);
        break;
      case 'setChatTitle':
        // Only the open chat's live title updates in place; the sidebar row is
        // refreshed via the invalidation below regardless.
        if (effect.chatId === chatId) {
          setTitle(effect.title);
          document.title = effect.title;
        }
        queryClient.invalidateQueries({ queryKey: qk.chatsInfiniteRoot });
        break;
    }
  };

  // One dispatch for every wire event (live send + reconnect/attach). Updates
  // the ref synchronously so the stream loop's next read sees this transition,
  // mirrors it into React state for rendering, then runs the reducer's effects.
  const dispatch = (action: StreamAction | UnknownStreamEvent) => {
    const prev = streamStateRef.current;
    // Unknown/unhandled wire types fall through the reducer's default (no-op).
    const { state, effects } = reduceStreamEvent(prev, action as StreamAction);
    streamStateRef.current = state;
    if (RENDER_KEYS.some((k) => prev[k] !== state[k])) setStreamState(state);
    for (const effect of effects) runEffect(effect);
  };

  // Attach to an already-running run (e.g. after a page refresh).
  // The partial assistant row is already loaded in `messages`; we replay
  // the event buffer from the server and tail live events.
  const attachToRun = async (
    userMessageId: string,
    loadedMessages?: Message[],
  ) => {
    activeRunMessageIdRef.current = userMessageId;
    const msgs = loadedMessages ?? streamStateRef.current.messages;
    const partialMsg = msgs.find(
      (m) => m.role === 'assistant' && m.runStatus === 'running',
    );
    if (!partialMsg) return; // No running row — might already be interrupted

    const aiMessageId = partialMsg.messageId;

    setLoading(true);
    // Seed the reducer for the reconnect/attach path: replay stays gated until
    // the server's `replay_complete` sentinel (the seeded content already bakes
    // in the replayed events), then live post-resume tokens append.
    dispatch({
      type: 'stream_started',
      mode: 'attach',
      chatId,
      aiMessageId,
      seedContent: partialMsg.content ?? '',
    });

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

    await readStream(reader, (data) => dispatch(normalizeStreamEvent(data)));
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
    for (let i = streamStateRef.current.messages.length - 1; i >= 0; i--) {
      if (streamStateRef.current.messages[i].role === 'assistant') {
        lastAssistantIdx = i;
        break;
      }
    }
    if (lastAssistantIdx === -1) return;
    const msgs = streamStateRef.current.messages.map((m, i) =>
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
        setTitle,
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
        setTitle,
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
                  // Group the restored approvals by bucket key, then seed each
                  // bucket in one `seed_approvals` reducer action. /api/approvals/
                  // pending is authoritative, so the reducer replaces that
                  // message's list; a concurrent SSE replay dedups by id.
                  const seeds = new Map<
                    string,
                    {
                      questions: PendingQuestion[];
                      executions: PendingExecution[];
                      editApprovals: PendingEditApproval[];
                      skillEditApprovals: PendingSkillEditApproval[];
                      mcpApprovals: PendingMcpApproval[];
                    }
                  >();
                  const bucket = (msgId: string) => {
                    const b = seeds.get(msgId) ?? {
                      questions: [],
                      executions: [],
                      editApprovals: [],
                      skillEditApprovals: [],
                      mcpApprovals: [],
                    };
                    seeds.set(msgId, b);
                    return b;
                  };
                  for (const approval of data.pending) {
                    const key = runningAssistantId ?? approval.messageId;
                    const p = approval.payload;
                    if (approval.toolKind === 'ask_user') {
                      bucket(key).questions.push({
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
                        status: 'pending',
                      });
                    } else if (approval.toolKind === 'code_execution') {
                      bucket(key).executions.push({
                        executionId: approval.approvalId,
                        code: p.code as string,
                        description: p.description as string | undefined,
                        toolCallId: p.toolCallId as string | undefined,
                        status: 'pending',
                      });
                    } else if (
                      approval.toolKind === 'workspace_edit' ||
                      approval.toolKind === 'workspace_create'
                    ) {
                      bucket(key).editApprovals.push({
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
                        workspaceAutoAccept: p.workspaceAutoAccept as boolean,
                        fileAutoAccept: p.fileAutoAccept as number | null,
                        createdAt: p.createdAt as number | undefined,
                        status: 'pending',
                      });
                    } else if (approval.toolKind === 'skill_edit') {
                      bucket(key).skillEditApprovals.push({
                        approvalId: approval.approvalId,
                        toolCallId: p.toolCallId as string | undefined,
                        action: p.action as 'create' | 'update' | 'delete',
                        name: p.name as string,
                        oldDescription: p.oldDescription as string,
                        newDescription: p.newDescription as string,
                        oldContent: p.oldContent as string,
                        newContent: p.newContent as string,
                        scope: p.scope as 'global' | 'workspace',
                        newScope: p.newScope as
                          | 'global'
                          | 'workspace'
                          | undefined,
                        oldDisableModelInvocation:
                          p.oldDisableModelInvocation as boolean | undefined,
                        disableModelInvocation: p.disableModelInvocation as
                          | boolean
                          | undefined,
                        workspaceId: p.workspaceId as string | null | undefined,
                        skillId: p.skillId as string | undefined,
                        createdAt: p.createdAt as number | undefined,
                        status: 'pending',
                      });
                    } else if (approval.toolKind === 'mcp_tool') {
                      bucket(key).mcpApprovals.push({
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
                        status: 'pending',
                      });
                    }
                  }
                  for (const [messageId, b] of seeds) {
                    dispatch({
                      type: 'seed_approvals',
                      messageId,
                      ...(b.questions.length ? { questions: b.questions } : {}),
                      ...(b.executions.length
                        ? { executions: b.executions }
                        : {}),
                      ...(b.editApprovals.length
                        ? { editApprovals: b.editApprovals }
                        : {}),
                      ...(b.skillEditApprovals.length
                        ? { skillEditApprovals: b.skillEditApprovals }
                        : {}),
                      ...(b.mcpApprovals.length
                        ? { mcpApprovals: b.mcpApprovals }
                        : {}),
                    });
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
      setChartSpecsByMessage((prev) => ({ ...hydrated, ...prev }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMessagesLoaded]);

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

    // Fresh turn: reset stream bookkeeping (received text, buffering, sources,
    // gathering/stats/progress). The assistant id is learned from the first
    // event that carries it; live events all carry their own id meanwhile.
    dispatch({
      type: 'stream_started',
      mode: 'live',
      chatId,
      aiMessageId: messageId,
    });

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
      // remount, set it here for the freshly-titled chat. This is the interim
      // title (matches what chat creation writes to the DB) until the auto-title
      // `setChatTitle` effect replaces it when the first answer completes.
      setTitle(message);
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

    await readStream(res.body.getReader(), (data) =>
      dispatch(normalizeStreamEvent(data)),
    );
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

  // Stable identity: passed down to memoized MarkdownRenderer via MessageBox.
  const handleThinkBoxToggle = useCallback(
    (messageId: string, thinkBoxId: string, expanded: boolean) => {
      setMessages((prev) =>
        prev.map((message) => {
          if (message.messageId === messageId) {
            const expandedThinkBoxes = new Set(
              message.expandedThinkBoxes || [],
            );
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
    },
    [setMessages],
  );

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
                  title={title}
                  onTitleChange={setTitle}
                  isPrivateSession={isPrivateSession}
                  pinned={pinned}
                  setPinned={setPinned}
                  workspaceId={selectedWorkspaceId ?? workspaceId}
                />
                <Chat
                  workspaceId={selectedWorkspaceId ?? workspaceId}
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
                  enabledSkills={enabledSkills}
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
                enabledSkills={enabledSkills}
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
