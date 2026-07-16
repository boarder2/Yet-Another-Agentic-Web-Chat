'use client';

import {
  EyeOff,
  Pin,
  MoreHorizontal,
  FileText,
  FileDown,
  Pencil,
} from 'lucide-react';
import { Message } from './ChatWindow';
import { useEffect, useState, Fragment, useMemo } from 'react';
import { formatTimeDifference } from '@/lib/utils';
import DeleteChat from './DeleteChat';
import {
  Popover,
  PopoverButton,
  PopoverPanel,
  Transition,
} from '@headlessui/react';
import { exportAsMarkdown, exportAsPDF } from '@/lib/chatExport';
import { useLocalStorageString } from '@/lib/hooks/useLocalStorage';
import { useInlineRename } from '@/lib/hooks/useInlineRename';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api/client';
import { qk } from '@/lib/api/keys';

const ChatActions = ({
  chatId,
  messages,
  title,
  onTitleChange,
  isPrivateSession = false,
  pinned = false,
  setPinned,
  workspaceId,
}: {
  messages: Message[];
  chatId: string;
  title: string;
  onTitleChange?: (title: string) => void;
  isPrivateSession?: boolean;
  pinned?: boolean;
  setPinned?: (pinned: boolean) => void;
  workspaceId?: string;
}) => {
  const qc = useQueryClient();
  const [privateSessionDurationMinutes] = useLocalStorageString(
    'privateSessionDurationMinutes',
    '1440',
  );
  const [expiresIn, setExpiresIn] = useState<string>('');
  const [, setTick] = useState(0);

  const displayTitle =
    title || (messages.length > 0 ? messages[0].content : '');

  const {
    isEditing,
    draftTitle,
    setDraftTitle,
    beginEdit,
    cancel,
    save: saveTitle,
  } = useInlineRename(chatId, displayTitle, (next) => {
    onTitleChange?.(next);
    document.title = next;
  });

  const timeAgo =
    messages.length > 0
      ? formatTimeDifference(new Date(), messages[0].createdAt)
      : '';

  const durationMs = useMemo(() => {
    const minutes = parseInt(privateSessionDurationMinutes, 10);
    return Number.isFinite(minutes) && minutes > 0
      ? minutes * 60 * 1000
      : 24 * 60 * 60 * 1000;
  }, [privateSessionDurationMinutes]);

  useEffect(() => {
    const intervalId = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!isPrivateSession || messages.length === 0) return;

    const computeExpiry = () => {
      const createdAt = new Date(messages[0].createdAt).getTime();
      const expiresAt = createdAt + durationMs;
      const remaining = expiresAt - Date.now();
      if (remaining <= 0) {
        setExpiresIn('expiring soon');
        return;
      }
      setExpiresIn(formatTimeDifference(new Date(), new Date(expiresAt)));
    };

    computeExpiry();
    const id = setInterval(computeExpiry, 60000);
    return () => clearInterval(id);
  }, [isPrivateSession, messages, durationMs]);

  return (
    <div
      className={`fixed top-3 z-40 right-4 sm:right-6 lg:right-8 flex items-center gap-2`}
    >
      {isPrivateSession && (
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-pill bg-warning-soft border border-warning text-warning dark:text-warning text-xs font-medium shrink-0">
          <EyeOff size={13} />
          <span>Private</span>
        </div>
      )}

      <button
        type="button"
        aria-label={pinned ? 'Unpin chat' : 'Pin chat'}
        onClick={async () => {
          const next = !pinned;
          if (setPinned) setPinned(next);
          try {
            await apiFetch(`/api/chats/${chatId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pinned: next }),
            });
            qc.invalidateQueries({ queryKey: qk.chatsInfiniteRoot });
          } catch {
            if (setPinned) setPinned(!next);
          }
        }}
        className="active:scale-95 transition duration-100 cursor-pointer p-2 rounded-pill hover:bg-surface-2"
      >
        <Pin size={17} className={pinned ? 'fill-current' : ''} />
      </button>

      <Popover className="relative">
        <PopoverButton className="active:scale-95 transition duration-100 cursor-pointer p-2 rounded-pill hover:bg-surface-2">
          <MoreHorizontal size={17} />
        </PopoverButton>
        <Transition
          as={Fragment}
          enter="transition ease-out duration-100"
          enterFrom="opacity-0 translate-y-1"
          enterTo="opacity-100 translate-y-0"
          leave="transition ease-in duration-75"
          leaveFrom="opacity-100 translate-y-0"
          leaveTo="opacity-0 translate-y-1"
        >
          <PopoverPanel className="absolute right-0 mt-2 w-80 rounded-floating shadow-floating bg-surface border border-surface-2 z-50">
            <div className="flex flex-col py-3 px-3 gap-3">
              <div className="px-3 py-2 flex flex-col gap-1">
                {isEditing ? (
                  <input
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
                    className="text-sm font-medium bg-surface-2 rounded-surface px-2 py-1 outline-none focus:ring-1 focus:ring-accent text-fg"
                  />
                ) : (
                  <div className="text-sm font-medium truncate text-fg">
                    {displayTitle}
                  </div>
                )}
                <div className="flex items-center gap-2">
                  {timeAgo && (
                    <span className="text-xs text-fg/50">{timeAgo} ago</span>
                  )}
                  {isPrivateSession && expiresIn && (
                    <span className="text-xs text-warning">
                      expires in {expiresIn}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  className="flex items-center gap-2 px-4 py-2 text-left hover:bg-surface-2 transition-colors rounded-surface font-medium text-sm"
                  onClick={beginEdit}
                >
                  <Pencil size={17} className="text-accent shrink-0" />
                  Rename chat
                </button>
                <button
                  type="button"
                  className="flex items-center gap-2 px-4 py-2 text-left hover:bg-surface-2 transition-colors rounded-surface font-medium text-sm"
                  onClick={() => exportAsMarkdown(messages, displayTitle || '')}
                >
                  <FileText size={17} className="text-accent shrink-0" />
                  Export as Markdown
                </button>
                <button
                  type="button"
                  className="flex items-center gap-2 px-4 py-2 text-left hover:bg-surface-2 transition-colors rounded-surface font-medium text-sm"
                  onClick={() => exportAsPDF(messages, displayTitle || '')}
                >
                  <FileDown size={17} className="text-accent shrink-0" />
                  Export as PDF
                </button>
              </div>

              <DeleteChat
                chatId={chatId}
                chats={[]}
                setChats={() => {}}
                redirectTo={workspaceId ? `/workspaces/${workspaceId}` : '/'}
                isPrivate={isPrivateSession}
                expiresIn={expiresIn}
                asMenuItem
              />
            </div>
          </PopoverPanel>
        </Transition>
      </Popover>
    </div>
  );
};

export default ChatActions;
