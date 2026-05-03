'use client';

import { EyeOff, Pin, MoreHorizontal, FileText, FileDown } from 'lucide-react';
import { Message } from './ChatWindow';
import { useEffect, useState, Fragment } from 'react';
import { formatTimeDifference } from '@/lib/utils';
import DeleteChat from './DeleteChat';
import {
  Popover,
  PopoverButton,
  PopoverPanel,
  Transition,
} from '@headlessui/react';
import { exportAsMarkdown, exportAsPDF } from '@/lib/chatExport';

const ChatActions = ({
  chatId,
  messages,
  isPrivateSession = false,
  pinned = false,
  setPinned,
}: {
  messages: Message[];
  chatId: string;
  isPrivateSession?: boolean;
  pinned?: boolean;
  setPinned?: (pinned: boolean) => void;
}) => {
  const [title, setTitle] = useState<string>('');
  const [timeAgo, setTimeAgo] = useState<string>('');
  const [expiresIn, setExpiresIn] = useState<string>('');

  useEffect(() => {
    if (messages.length > 0) {
      setTitle(messages[0].content);
      const newTimeAgo = formatTimeDifference(
        new Date(),
        messages[0].createdAt,
      );
      setTimeAgo(newTimeAgo);
    }
  }, [messages]);

  useEffect(() => {
    const intervalId = setInterval(() => {
      if (messages.length > 0) {
        const newTimeAgo = formatTimeDifference(
          new Date(),
          messages[0].createdAt,
        );
        setTimeAgo(newTimeAgo);
      }
    }, 60000);

    return () => clearInterval(intervalId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isPrivateSession || messages.length === 0) return;

    let durationMs = 24 * 60 * 60 * 1000; // default 24h

    const fetchAndCompute = async () => {
      try {
        const res = await fetch('/api/config');
        if (res.ok) {
          const data = await res.json();
          if (typeof data.privateSessionDurationMinutes === 'number') {
            durationMs = data.privateSessionDurationMinutes * 60 * 1000;
          }
        }
      } catch {
        // use default
      }

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
      return id;
    };

    let intervalId: ReturnType<typeof setInterval> | undefined;
    fetchAndCompute().then((id) => {
      intervalId = id;
    });
    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [isPrivateSession, messages]);

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
        aria-label={pinned ? 'Unpin chat' : 'Pin chat'}
        onClick={async () => {
          const next = !pinned;
          if (setPinned) setPinned(next);
          try {
            const res = await fetch(`/api/chats/${chatId}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ pinned: next }),
            });
            if (!res.ok && setPinned) setPinned(!next);
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
                <div className="text-sm font-medium truncate text-fg">
                  {title}
                </div>
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
                  className="flex items-center gap-2 px-4 py-2 text-left hover:bg-surface-2 transition-colors rounded-surface font-medium text-sm"
                  onClick={() => exportAsMarkdown(messages, title || '')}
                >
                  <FileText size={17} className="text-accent shrink-0" />
                  Export as Markdown
                </button>
                <button
                  className="flex items-center gap-2 px-4 py-2 text-left hover:bg-surface-2 transition-colors rounded-surface font-medium text-sm"
                  onClick={() => exportAsPDF(messages, title || '')}
                >
                  <FileDown size={17} className="text-accent shrink-0" />
                  Export as PDF
                </button>
              </div>

              <DeleteChat
                chatId={chatId}
                chats={[]}
                setChats={() => {}}
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
