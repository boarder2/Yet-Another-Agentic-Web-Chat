import { Trash } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Chat } from '@/components/Chats/ChatRow';
import { IconButton } from '@/components/ui/IconButton';
import ConfirmModal from '@/components/ui/ConfirmModal';

const DeleteChat = ({
  chatId,
  chats,
  setChats,
  redirectTo,
  isPrivate = false,
  expiresIn,
  asMenuItem = false,
}: {
  chatId: string;
  chats: Chat[];
  setChats: (chats: Chat[]) => void;
  redirectTo?: string;
  isPrivate?: boolean;
  expiresIn?: string;
  asMenuItem?: boolean;
}) => {
  const [confirmationDialogOpen, setConfirmationDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const close = () => !loading && setConfirmationDialogOpen(false);

  const handleDelete = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/chats/${chatId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (res.status != 200) {
        throw new Error('Failed to delete chat');
      }

      const newChats = chats.filter((chat) => chat.id !== chatId);

      setChats(newChats);

      setConfirmationDialogOpen(false);
      if (redirectTo) {
        window.location.href = redirectTo;
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {asMenuItem ? (
        <button
          type="button"
          onClick={() => setConfirmationDialogOpen(true)}
          className="flex items-center gap-2 border border-transparent px-4 py-2 text-left hover:bg-surface-2 transition-colors duration-150 rounded-surface font-medium text-sm text-danger w-full focus-border-contrast"
        >
          <Trash size={17} className="shrink-0" />
          Delete chat
        </button>
      ) : (
        <IconButton
          icon={Trash}
          label="Delete chat"
          tone="danger"
          onClick={() => setConfirmationDialogOpen(true)}
        />
      )}
      <ConfirmModal
        open={confirmationDialogOpen}
        onClose={close}
        title="Delete Confirmation"
        body={
          <>
            Are you sure you want to delete this chat?
            {isPrivate && expiresIn
              ? ` It is a private chat and would expire on its own in ${expiresIn}.`
              : ''}
          </>
        }
        loading={loading}
        onConfirm={() => {
          void handleDelete();
        }}
      />
    </>
  );
};

export default DeleteChat;
