import { ShieldAlert, Trash } from 'lucide-react';
import {
  Description,
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from '@headlessui/react';
import { Fragment, useState } from 'react';
import { toast } from 'sonner';
import { Chat } from '@/components/Chats/ChatRow';

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
          onClick={() => setConfirmationDialogOpen(true)}
          className="flex items-center gap-2 px-4 py-2 text-left hover:bg-surface-2 transition-colors rounded-surface font-medium text-sm text-danger w-full"
        >
          <Trash size={17} className="shrink-0" />
          Delete chat
        </button>
      ) : isPrivate ? (
        <button
          onClick={() => setConfirmationDialogOpen(true)}
          className="flex items-center gap-1.5 px-2 py-1 rounded-surface bg-danger-soft border border-danger text-danger hover:bg-danger-soft transition duration-200 text-xs"
        >
          <ShieldAlert size={14} />
          <span>Delete</span>
          {expiresIn && <span className="opacity-60">· {expiresIn}</span>}
        </button>
      ) : (
        <button
          onClick={() => {
            setConfirmationDialogOpen(true);
          }}
          className="bg-transparent text-danger hover:scale-105 transition duration-200"
        >
          <Trash size={17} />
        </button>
      )}
      <Transition appear show={confirmationDialogOpen} as={Fragment}>
        <Dialog
          as="div"
          className="relative z-50"
          onClose={() => {
            if (!loading) {
              setConfirmationDialogOpen(false);
            }
          }}
        >
          <DialogBackdrop className="fixed inset-0 bg-fg/30" />
          <div className="fixed inset-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center p-4 text-center">
              <TransitionChild
                as={Fragment}
                enter="ease-out duration-200"
                enterFrom="opacity-0 scale-95"
                enterTo="opacity-100 scale-100"
                leave="ease-in duration-100"
                leaveFrom="opacity-100 scale-200"
                leaveTo="opacity-0 scale-95"
              >
                <DialogPanel className="w-full max-w-md transform rounded-floating bg-surface border border-surface-2 p-6 text-left align-middle shadow-floating transition-all">
                  <DialogTitle className="text-lg font-medium leading-6">
                    Delete Confirmation
                  </DialogTitle>
                  <Description className="text-sm">
                    Are you sure you want to delete this chat?
                  </Description>
                  <div className="flex flex-row items-end justify-end space-x-4 mt-6">
                    <button
                      onClick={() => {
                        if (!loading) {
                          setConfirmationDialogOpen(false);
                        }
                      }}
                      className="text-sm transition duration-200"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleDelete}
                      className="text-danger text-sm hover:text-danger transition duration200"
                    >
                      Delete
                    </button>
                  </div>
                </DialogPanel>
              </TransitionChild>
            </div>
          </div>
        </Dialog>
      </Transition>
    </>
  );
};

export default DeleteChat;
