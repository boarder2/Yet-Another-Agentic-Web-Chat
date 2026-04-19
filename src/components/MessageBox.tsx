import { cn } from '@/lib/utils';
import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { File, ImageAttachment, Message } from './ChatWindow';
import MarkdownRenderer from './MarkdownRenderer';
import MessageInput from './MessageInput';
import MessageTabs from './MessageTabs';
import { Document } from '@langchain/core/documents';
const MessageBox = ({
  message,
  messageIndex,
  history,
  loading,
  isLast,
  rewrite,
  sendMessage,
  handleEditMessage,
  onThinkBoxToggle,
  analysisProgress,
  modelStats,
  gatheringSources,
  actionMessageId,
  editInputProps,
}: {
  message: Message;
  messageIndex: number;
  history: Message[];
  loading: boolean;
  isLast: boolean;
  rewrite: (messageId: string) => void;
  sendMessage: (
    message: string,
    options?: {
      messageId?: string;
      rewriteIndex?: number;
      suggestions?: string[];
    },
  ) => void;
  handleEditMessage: (
    messageId: string,
    content: string,
    images?: ImageAttachment[],
  ) => void;
  onThinkBoxToggle: (
    messageId: string,
    thinkBoxId: string,
    expanded: boolean,
  ) => void;
  analysisProgress?: {
    message: string;
    current: number;
    total: number;
    subMessage?: string;
  } | null;
  modelStats?: {
    usage?: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
    };
    usageChat?: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
    };
    usageSystem?: {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
    };
  } | null;
  gatheringSources?: Array<{
    searchQuery: string;
    sources: Document[];
  }>;
  actionMessageId?: string;
  editInputProps: {
    fileIds: string[];
    setFileIds: (fileIds: string[]) => void;
    files: File[];
    setFiles: (files: File[]) => void;
    focusMode: string;
    setFocusMode: (mode: string) => void;
    systemPromptIds: string[];
    setSystemPromptIds: (ids: string[]) => void;
    selectedMethodologyId?: string | null;
    setSelectedMethodologyId?: (id: string | null) => void;
    sendLocation: boolean;
    setSendLocation: (value: boolean) => void;
    sendPersonalization: boolean;
    setSendPersonalization: (value: boolean) => void;
    personalizationLocation?: string;
    personalizationAbout?: string;
    refreshPersonalization?: () => void;
    imageCapable?: boolean;
  };
}) => {
  // Local state for editing functionality
  const [isEditing, setIsEditing] = useState(false);
  const [editPendingImages, setEditPendingImages] = useState<ImageAttachment[]>(
    [],
  );
  // Initialize editing
  const startEditMessage = () => {
    if (loading) return;
    setIsEditing(true);
    setEditPendingImages(message.images ? [...message.images] : []);
  };

  // Cancel editing
  const cancelEditMessage = () => {
    setIsEditing(false);
    setEditPendingImages([]);
  };

  // Submit edit via the reused MessageInput component
  const handleEditSubmit = (msg: string) => {
    handleEditMessage(message.messageId, msg, editPendingImages);
    setIsEditing(false);
  };

  return (
    <div>
      {message.role === 'user' && (
        <div
          className={cn(
            'w-full',
            messageIndex === 0 ? 'pt-16' : 'pt-8',
            'break-words',
          )}
        >
          {isEditing ? (
            <div className="w-full">
              <MessageInput
                {...editInputProps}
                sendMessage={handleEditSubmit}
                loading={false}
                firstMessage={false}
                pendingImages={editPendingImages}
                setPendingImages={setEditPendingImages}
                initialMessage={message.content}
                onCancelEdit={cancelEditMessage}
              />
            </div>
          ) : (
            <div className="ml-[15%]">
              <div className="relative bg-surface-2 rounded-xl px-4 py-3 border-b-2 border-accent">
                <button
                  onClick={startEditMessage}
                  disabled={loading}
                  className={cn(
                    'absolute top-2 right-2 p-1.5 rounded-lg flex-shrink-0',
                    loading
                      ? 'opacity-40 cursor-not-allowed'
                      : 'hover:bg-surface',
                  )}
                  aria-label="Edit message"
                  title="Edit message"
                >
                  <Pencil size={16} />
                </button>
                <div className="pr-8">
                  <MarkdownRenderer content={message.content} />
                </div>
                {message.images && message.images.length > 0 && (
                  <div className="flex flex-row gap-2 mt-3 flex-wrap">
                    {message.images.map((img) => (
                      <img
                        key={img.imageId}
                        src={`/api/uploads/images/${img.imageId}`}
                        alt={img.fileName}
                        className="max-h-40 max-w-[200px] object-cover rounded-lg border border-surface-2"
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {message.role === 'assistant' && (
        <MessageTabs
          query={history[messageIndex - 1].content}
          chatHistory={history.slice(0, messageIndex - 1)}
          messageId={message.messageId}
          message={message}
          isLast={isLast}
          loading={loading}
          rewrite={rewrite}
          sendMessage={sendMessage}
          onThinkBoxToggle={onThinkBoxToggle}
          analysisProgress={analysisProgress}
          modelStats={modelStats}
          gatheringSources={gatheringSources}
          actionMessageId={actionMessageId}
        />
      )}
    </div>
  );
};

export default MessageBox;
