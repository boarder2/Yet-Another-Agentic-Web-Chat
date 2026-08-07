'use client';

import DeleteChat from '@/components/DeleteChat';
import WorkspaceChip from '@/components/Workspaces/WorkspaceChip';
import { cn, formatTimeDifference } from '@/lib/utils';
import { Input } from '@/components/ui/Input';
import {
  ListRow,
  ListRowAction,
  listRowInteractive,
} from '@/components/ui/List';
import {
  AlertCircle,
  CalendarClock,
  EyeOff,
  Hand,
  LoaderCircle,
  OctagonX,
  Pencil,
  Pin,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useCancelRun, useMarkChatSeen } from '@/lib/hooks/api/useActiveRuns';
import { useInlineRename } from '@/lib/hooks/useInlineRename';

export interface Chat {
  id: string;
  title: string;
  createdAt: number;
  focusMode: string;
  isPrivate?: number;
  pinned?: number;
  scheduleId?: string | null;
  workflowId?: string | null;
  workspaceId?: string | null;
  matchExcerpt?: string | null;
  messageCount?: number;
  activeRunMessageId?: string | null;
  activeRunStartedAt?: number | null;
  activeRunStatus?: 'running' | 'awaiting_user' | null;
  lastRunStatus?:
    | 'completed'
    | 'errored'
    | 'cancelled'
    | 'interrupted'
    | 'awaiting_user'
    | null;
  lastRunViewed?: number | null;
}

export interface WorkspaceMeta {
  name: string;
  icon: string | null;
  color: string | null;
  archived: boolean;
}

const HighlightedExcerpt = ({
  text,
  terms,
}: {
  text: string;
  terms: string[];
}) => {
  for (const term of terms) {
    if (!term) continue;
    const idx = text.toLowerCase().indexOf(term.toLowerCase());
    if (idx !== -1) {
      return (
        <>
          {text.slice(0, idx)}
          <span className="font-medium text-accent">
            {text.slice(idx, idx + term.length)}
          </span>
          {text.slice(idx + term.length)}
        </>
      );
    }
  }
  return <>{text}</>;
};

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return `${String(m).padStart(2, '0')}:${String(rs).padStart(2, '0')}`;
}

function ElapsedTimer({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(() => Date.now() - startedAt);

  useEffect(() => {
    const id = setInterval(() => setElapsed(Date.now() - startedAt), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  return <span>{formatElapsed(elapsed)}</span>;
}

interface ChatRowProps {
  chat: Chat;
  isSearchMode: boolean;
  searchTerms: string[];
  /** When set, hides the per-row workspace chip (we're already scoped). */
  hideWorkspaceChip?: boolean;
  /** When set, navigate to the workspace-scoped chat URL instead of /c/:id */
  scopedWorkspaceId?: string;
  workspace?: WorkspaceMeta | null;
  privateSessionDurationMs: number;
  onDelete: (chatId: string) => void;
}

function getPrivateExpiresIn(createdAt: number, durationMs: number): string {
  const expiresAt = createdAt + durationMs;
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) return 'expiring soon';
  return formatTimeDifference(new Date(), new Date(expiresAt));
}

const ChatRow = ({
  chat,
  isSearchMode,
  searchTerms,
  hideWorkspaceChip,
  scopedWorkspaceId,
  workspace,
  privateSessionDurationMs,
  onDelete,
}: ChatRowProps) => {
  const chatUrl = scopedWorkspaceId
    ? `/workspaces/${scopedWorkspaceId}/c/${chat.id}`
    : `/c/${chat.id}`;

  const cancelRun = useCancelRun();
  const markSeen = useMarkChatSeen();
  const stopClickedRef = useRef(false);
  const {
    isEditing,
    draftTitle,
    setDraftTitle,
    beginEdit,
    cancel,
    save: saveTitle,
  } = useInlineRename(chat.id, chat.title);

  const isAwaitingUser = chat.activeRunStatus === 'awaiting_user';
  const isInProgress = !!chat.activeRunMessageId && !isAwaitingUser;
  const isUnviewed =
    !chat.activeRunMessageId &&
    chat.lastRunViewed === 0 &&
    chat.lastRunStatus != null;

  const expiresIn =
    chat.isPrivate === 1
      ? getPrivateExpiresIn(chat.createdAt, privateSessionDurationMs)
      : undefined;

  const handleStop = () => {
    if (!chat.activeRunMessageId || stopClickedRef.current) return;
    stopClickedRef.current = true;
    cancelRun.mutate(chat.activeRunMessageId, {
      onSettled: () => {
        stopClickedRef.current = false;
        // Self-initiated stop should not badge, so mark seen immediately.
        markSeen.mutate(chat.id);
      },
    });
  };

  const status = isAwaitingUser ? (
    <span className="flex items-center gap-1.5 text-warning">
      <Hand size={13} className="animate-pulse" />
      Needs input
    </span>
  ) : isInProgress ? (
    <span className="flex items-center gap-1.5">
      <LoaderCircle size={13} className="animate-spin text-accent" />
      Working… <ElapsedTimer startedAt={chat.activeRunStartedAt ?? 0} />
    </span>
  ) : isUnviewed &&
    (chat.lastRunStatus === 'errored' ||
      chat.lastRunStatus === 'interrupted') ? (
    <span className="flex items-center gap-1.5 text-danger">
      <AlertCircle size={13} />
      {chat.lastRunStatus === 'interrupted' ? 'Interrupted' : 'Error'}
    </span>
  ) : isUnviewed && chat.lastRunStatus === 'cancelled' ? (
    <span className="flex items-center gap-1.5">
      <OctagonX size={13} />
      Stopped
    </span>
  ) : null;

  return (
    <ListRow
      href={isEditing ? undefined : chatUrl}
      leading={
        <>
          {isUnviewed && (
            <span className="h-2.5 w-2.5 shrink-0 rounded-pill bg-accent" />
          )}
          {chat.pinned === 1 && (
            <Pin size={12} className="shrink-0 fill-current text-fg/50" />
          )}
        </>
      }
      title={
        isEditing ? (
          <Input
            type="text"
            aria-label="Chat title"
            maxLength={200}
            value={draftTitle}
            autoFocus
            onChange={(e) => setDraftTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveTitle();
              if (e.key === 'Escape') cancel();
            }}
            onBlur={cancel}
            className="w-full min-w-0 rounded-surface bg-surface-2 px-2 py-0.5 text-base font-medium"
          />
        ) : (
          chat.title
        )
      }
      body={
        isSearchMode && chat.matchExcerpt ? (
          <p className="line-clamp-2 text-sm text-fg/60">
            <HighlightedExcerpt text={chat.matchExcerpt} terms={searchTerms} />
          </p>
        ) : undefined
      }
      meta={
        <>
          {status}
          <span>
            {expiresIn
              ? `Expires in ${expiresIn}`
              : `${formatTimeDifference(new Date(), new Date(chat.createdAt))} ago`}
          </span>
          {typeof chat.messageCount === 'number' && (
            <span>
              {chat.messageCount} message{chat.messageCount === 1 ? '' : 's'}
            </span>
          )}
          {chat.isPrivate === 1 && (
            <span className="flex items-center gap-1 whitespace-nowrap rounded-pill border border-warning bg-warning-soft px-2 py-0.5 font-medium text-warning">
              <EyeOff size={11} />
              Private
            </span>
          )}
          {chat.scheduleId && (
            <Link
              href={`/automations/schedules/${chat.scheduleId}`}
              className={cn(
                'flex items-center gap-1 whitespace-nowrap rounded-pill border border-info bg-info-soft px-2 py-0.5 font-medium text-info transition-opacity hover:opacity-80',
                listRowInteractive,
              )}
            >
              <CalendarClock size={11} />
              Scheduled
            </Link>
          )}
          {!hideWorkspaceChip && chat.workspaceId && workspace && (
            <span className={listRowInteractive}>
              <WorkspaceChip
                id={chat.workspaceId}
                name={workspace.name}
                icon={workspace.icon}
                color={workspace.color}
                muted={workspace.archived}
                inert
              />
            </span>
          )}
        </>
      }
      actions={
        <>
          {(isInProgress || isAwaitingUser) && (
            <ListRowAction
              icon={OctagonX}
              label="Stop run"
              danger
              loading={cancelRun.isPending}
              onClick={handleStop}
            />
          )}
          <ListRowAction
            icon={Pencil}
            label="Rename chat"
            onClick={beginEdit}
          />
          <DeleteChat
            chatId={chat.id}
            chats={[chat] as Chat[]}
            setChats={() => onDelete(chat.id)}
            isPrivate={chat.isPrivate === 1}
            expiresIn={expiresIn}
          />
        </>
      }
    />
  );
};

export default ChatRow;
