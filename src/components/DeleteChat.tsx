import { Trash } from 'lucide-react';
import { Description } from '@headlessui/react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Chat } from '@/components/Chats/ChatRow';
import { Button } from '@/components/ui/Button';
import { ListRowAction } from '@/components/ui/List';
import Modal from '@/components/ui/Modal';

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

      if (redirectTo) {
        window.location.href = redirectTo;
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setConfirmationDialogOpen(false);
      setLoading(false);
    }
  };

  return (
    <>
      {asMenuItem ? (
        <button
          type="button"
          onClick={() => setConfirmationDialogOpen(true)}
          className="flex items-center gap-2 px-4 py-2 text-left hover:bg-surface-2 transition-colors rounded-surface font-medium text-sm text-danger w-full"
        >
          <Trash size={17} className="shrink-0" />
          Delete chat
        </button>
      ) : (
        <ListRowAction
          icon={Trash}
          label="Delete chat"
          danger
          onClick={() => setConfirmationDialogOpen(true)}
        />
      )}
      <Modal
        open={confirmationDialogOpen}
        onClose={close}
        size="sm"
        title="Delete Confirmation"
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Cancel
            </Button>
            <Button variant="danger" loading={loading} onClick={handleDelete}>
              Delete
            </Button>
          </>
        }
      >
        <Description className="text-sm">
          Are you sure you want to delete this chat?
          {isPrivate && expiresIn
            ? ` It is a private chat and would expire on its own in ${expiresIn}.`
            : ''}
        </Description>
      </Modal>
    </>
  );
};

export default DeleteChat;
