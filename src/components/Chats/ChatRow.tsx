'use client';

import DeleteChat from '@/components/DeleteChat';
import WorkspaceChip from '@/components/Workspaces/WorkspaceChip';
import { cn, formatTimeDifference } from '@/lib/utils';
import {
  AlertCircle,
  CalendarClock,
  ClockIcon,
  EyeOff,
  Hand,
  LoaderCircle,
  MessageSquare,
  OctagonX,
  Pin,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useCancelRun, useMarkChatSeen } from '@/lib/hooks/api/useActiveRuns';

export interface Chat {
  id: string;
  title: string;
  createdAt: number;
  focusMode: string;
  isPrivate?: number;
  pinned?: number;
  scheduledTaskId?: string | null;
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
  isLast: boolean;
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
  isLast,
  isSearchMode,
  searchTerms,
  hideWorkspaceChip,
  scopedWorkspaceId,
  workspace,
  privateSessionDurationMs,
  onDelete,
}: ChatRowProps) => {
  const router = useRouter();
  const chatUrl = scopedWorkspaceId
    ? `/workspaces/${scopedWorkspaceId}/c/${chat.id}`
    : `/c/${chat.id}`;

  const cancelRun = useCancelRun();
  const markSeen = useMarkChatSeen();
  const stopClickedRef = useRef(false);

  const isAwaitingUser = chat.activeRunStatus === 'awaiting_user';
  const isInProgress = !!chat.activeRunMessageId && !isAwaitingUser;
  const isUnviewed =
    !chat.activeRunMessageId &&
    chat.lastRunViewed === 0 &&
    chat.lastRunStatus != null;

  const startedAt = chat.activeRunStartedAt ?? 0;

  const handleStop = (e: React.MouseEvent) => {
    e.stopPropagation();
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

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => router.push(chatUrl)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') router.push(chatUrl);
      }}
      className={cn(
        'flex flex-col space-y-4 py-6 relative group cursor-pointer',
        !isLast ? 'border-b border-surface-2' : '',
      )}
    >
      <div className="flex items-center gap-2">
        {isUnviewed && (
          <span className="shrink-0 w-2.5 h-2.5 rounded-pill bg-accent" />
        )}
        <span className="lg:text-xl font-medium truncate transition duration-200 group-hover:text-accent">
          {chat.title}
        </span>
        {chat.pinned === 1 && (
          <Pin size={12} className="fill-current text-fg/50 shrink-0" />
        )}
        {chat.isPrivate === 1 && (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-pill bg-warning-soft border border-warning text-warning dark:text-warning text-xs font-medium whitespace-nowrap">
            <EyeOff size={11} />
            Private
          </span>
        )}
      </div>
      {isSearchMode && chat.matchExcerpt && (
        <p className="text-sm text-fg/60 line-clamp-2 -mt-1">
          <HighlightedExcerpt text={chat.matchExcerpt} terms={searchTerms} />
        </p>
      )}
      <div className="flex flex-row items-center justify-between w-full">
        <div className="flex flex-row items-center gap-2 flex-wrap">
          {isAwaitingUser ? (
            <div className="flex items-center gap-2 text-warning">
              <Hand size={14} className="animate-pulse" />
              <span className="text-xs">Needs input</span>
            </div>
          ) : isInProgress ? (
            <div className="flex items-center gap-2 text-fg/70">
              <LoaderCircle size={14} className="animate-spin text-accent" />
              <span className="text-xs">
                Working… <ElapsedTimer startedAt={startedAt} />
              </span>
            </div>
          ) : isUnviewed &&
            (chat.lastRunStatus === 'errored' ||
              chat.lastRunStatus === 'interrupted') ? (
            <div className="flex items-center gap-1.5 text-danger text-xs">
              <AlertCircle size={14} />
              <span>
                {chat.lastRunStatus === 'interrupted' ? 'Interrupted' : 'Error'}
              </span>
            </div>
          ) : isUnviewed && chat.lastRunStatus === 'cancelled' ? (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-pill bg-surface-2 text-fg/50 text-xs font-medium">
              <OctagonX size={11} />
              Stopped
            </span>
          ) : (
            <div className="flex flex-row items-center space-x-1 lg:space-x-1.5 opacity-70">
              {chat.isPrivate === 1 ? (
                <>
                  <ClockIcon size={15} />
                  <p className="text-xs">
                    Expires in{' '}
                    {getPrivateExpiresIn(
                      chat.createdAt,
                      privateSessionDurationMs,
                    )}
                  </p>
                </>
              ) : (
                <>
                  <ClockIcon size={15} />
                  <p className="text-xs">
                    {formatTimeDifference(new Date(), new Date(chat.createdAt))}{' '}
                    Ago
                  </p>
                </>
              )}
              {typeof chat.messageCount === 'number' && (
                <>
                  <span className="mx-1.5 text-fg/30">·</span>
                  <MessageSquare size={13} />
                  <p className="text-xs">
                    {chat.messageCount} message
                    {chat.messageCount === 1 ? '' : 's'}
                  </p>
                </>
              )}
            </div>
          )}
          {chat.scheduledTaskId && (
            <Link
              href={`/scheduled-tasks/manage/${chat.scheduledTaskId}/edit`}
              className="flex items-center gap-1 px-2 py-0.5 rounded-pill bg-info-soft border border-info text-info dark:text-info text-xs font-medium whitespace-nowrap hover:opacity-80 transition-opacity"
              onClick={(e) => e.stopPropagation()}
            >
              <CalendarClock size={11} />
              Scheduled
            </Link>
          )}
          {!hideWorkspaceChip && chat.workspaceId && workspace && (
            <WorkspaceChip
              id={chat.workspaceId}
              name={workspace.name}
              icon={workspace.icon}
              color={workspace.color}
              muted={workspace.archived}
            />
          )}
        </div>
        <div
          className="flex items-center gap-2"
          onClick={(e) => e.stopPropagation()}
        >
          {(isInProgress || isAwaitingUser) && (
            <button
              type="button"
              onClick={handleStop}
              disabled={cancelRun.isPending}
              className={cn(
                'flex items-center gap-1 px-2 py-1 rounded-control text-xs font-medium border transition-colors duration-150',
                'bg-danger-soft border-danger text-danger hover:bg-danger hover:text-danger-fg',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
              aria-label="Stop run"
            >
              {cancelRun.isPending ? (
                <LoaderCircle size={12} className="animate-spin" />
              ) : (
                <OctagonX size={12} />
              )}
              Stop
            </button>
          )}
          <DeleteChat
            chatId={chat.id}
            chats={[chat] as Chat[]}
            setChats={() => onDelete(chat.id)}
            isPrivate={chat.isPrivate === 1}
            expiresIn={
              chat.isPrivate === 1
                ? getPrivateExpiresIn(chat.createdAt, privateSessionDurationMs)
                : undefined
            }
          />
        </div>
      </div>
    </div>
  );
};

export default ChatRow;
