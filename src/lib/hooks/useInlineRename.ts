'use client';

import { useState } from 'react';
import { useRenameChat } from '@/lib/hooks/api/useChats';

/**
 * Inline chat-title editing state + save/cancel logic, shared by every rename
 * affordance (in-chat header, sidebar row). Save is a no-op when the draft is
 * empty or unchanged; `onRenamed` lets a caller mirror the new title into its
 * own state (e.g. the open chat's title + tab title).
 */
export function useInlineRename(
  chatId: string,
  currentTitle: string,
  onRenamed?: (title: string) => void,
) {
  const renameChat = useRenameChat();
  const [isEditing, setIsEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(currentTitle);

  const beginEdit = () => {
    setDraftTitle(currentTitle);
    setIsEditing(true);
  };
  const cancel = () => setIsEditing(false);
  const save = () => {
    const next = draftTitle.trim();
    if (next && next !== currentTitle) {
      renameChat.mutate({ id: chatId, title: next });
      onRenamed?.(next);
    }
    setIsEditing(false);
  };

  return { isEditing, draftTitle, setDraftTitle, beginEdit, cancel, save };
}
