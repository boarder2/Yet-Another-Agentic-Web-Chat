'use client';

import DeleteChat from '@/components/DeleteChat';
import WorkspaceChip from '@/components/Workspaces/WorkspaceChip';
import { cn, formatTimeDifference } from '@/lib/utils';
import {
  CalendarClock,
  ClockIcon,
  EyeOff,
  MessageSquare,
  Pin,
} from 'lucide-react';
import Link from 'next/link';

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

interface ChatRowProps {
  chat: Chat;
  isLast: boolean;
  isSearchMode: boolean;
  searchTerms: string[];
  /** When set, hides the per-row workspace chip (we're already scoped). */
  hideWorkspaceChip?: boolean;
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
  workspace,
  privateSessionDurationMs,
  onDelete,
}: ChatRowProps) => {
  return (
    <div
      className={cn(
        'flex flex-col space-y-4 py-6',
        !isLast ? 'border-b border-surface-2' : '',
      )}
    >
      <div className="flex items-center gap-2">
        <Link
          href={`/c/${chat.id}`}
          className="lg:text-xl font-medium truncate transition duration-200 cursor-pointer"
        >
          {chat.title}
        </Link>
        {chat.pinned === 1 && (
          <Pin size={12} className="fill-current text-fg/50 shrink-0" />
        )}
        {chat.isPrivate === 1 && (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs font-medium whitespace-nowrap">
            <EyeOff size={11} />
            Private
          </span>
        )}
        {chat.scheduledTaskId && (
          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 text-xs font-medium whitespace-nowrap">
            <CalendarClock size={11} />
            Scheduled
          </span>
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
      {isSearchMode && chat.matchExcerpt && (
        <p className="text-sm text-fg/60 line-clamp-2 -mt-1">
          <HighlightedExcerpt text={chat.matchExcerpt} terms={searchTerms} />
        </p>
      )}
      <div className="flex flex-row items-center justify-between w-full">
        <div className="flex flex-row items-center space-x-1 lg:space-x-1.5 opacity-70">
          {chat.isPrivate === 1 ? (
            <>
              <ClockIcon size={15} />
              <p className="text-xs">
                Expires in{' '}
                {getPrivateExpiresIn(chat.createdAt, privateSessionDurationMs)}
              </p>
            </>
          ) : (
            <>
              <ClockIcon size={15} />
              <p className="text-xs">
                {formatTimeDifference(new Date(), new Date(chat.createdAt))} Ago
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
  );
};

export default ChatRow;
