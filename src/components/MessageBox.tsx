import { cn } from '@/lib/utils';
import { Pencil } from 'lucide-react';
import Image from 'next/image';
import { useState } from 'react';
import { File, ImageAttachment, Message } from './ChatWindow';
import { SKILL_TOKEN_SCAN_REGEX } from '@/lib/skills/validation';
import MarkdownRenderer from './MarkdownRenderer';
import MessageInput from './MessageInput';
import MessageTabs from './MessageTabs';
import { IconButton } from '@/components/ui/IconButton';
import { Document } from '@langchain/core/documents';
// Wrap valid /skill-name tokens with <SkillToken> so MarkdownRenderer styles
// them with the accent color. Skips fenced code blocks and inline `code` spans.
const highlightSkillTokens = (
  content: string,
  skillNames?: Set<string>,
): string => {
  if (!skillNames || skillNames.size === 0) return content;
  let inFence = false;
  return content
    .split('\n')
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      return line
        .split(/(`[^`]*`)/g)
        .map((part) =>
          part.startsWith('`')
            ? part
            : part.replace(SKILL_TOKEN_SCAN_REGEX, (match, name) => {
                if (!skillNames.has(name)) return match;
                // Preserve the leading boundary char (whitespace or empty)
                const pre = match.slice(0, match.length - name.length - 1);
                return `${pre}<SkillToken>/${name}</SkillToken>`;
              }),
        )
        .join('');
    })
    .join('\n');
};

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
  gatheringSources,
  actionMessageId,
  editInputProps,
  isPrivateSession,
  searchCapabilities,
  skillNames,
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
  isPrivateSession?: boolean;
  searchCapabilities?: {
    web: boolean;
    images: boolean;
    videos: boolean;
    autocomplete: boolean;
  };
  skillNames?: Set<string>;
}) => {
  // Local state for editing functionality
  const [isEditing, setIsEditing] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const isLongMessage =
    message.role === 'user' && message.content.split('\n').length > 5;
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
    <div id={`msg-${message.messageId}`}>
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
              <div className="relative bg-surface-2 rounded-floating px-4 py-3 border-b-2 border-accent overflow-hidden">
                <IconButton
                  icon={Pencil}
                  label="Edit message"
                  onClick={startEditMessage}
                  disabled={loading}
                  className="absolute right-2 top-2 z-10"
                />
                <div
                  className={cn(
                    'relative pr-8',
                    isLongMessage && isCollapsed && 'max-h-32 overflow-hidden',
                  )}
                >
                  <MarkdownRenderer
                    content={highlightSkillTokens(message.content, skillNames)}
                  />
                  {isLongMessage && isCollapsed && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-linear-to-t from-surface-2 to-transparent" />
                  )}
                </div>
                {message.images && message.images.length > 0 && (
                  <div className="flex flex-row gap-2 mt-3 flex-wrap">
                    {message.images.map((img) => (
                      <Image
                        key={img.imageId}
                        src={`/api/uploads/images/${img.imageId}`}
                        alt={img.fileName}
                        width={200}
                        height={160}
                        className="max-h-40 max-w-[200px] h-auto object-cover rounded-surface border border-surface-2"
                      />
                    ))}
                  </div>
                )}
                {isLongMessage && isCollapsed && (
                  <button
                    type="button"
                    onClick={() => setIsCollapsed(false)}
                    className="-mx-4 -mb-3 mt-1 w-[calc(100%+2rem)] border border-transparent py-2 bg-surface-2 text-center text-xs font-medium text-accent hover:bg-surface transition-colors duration-150 focus-border-neutral"
                    aria-label="Show full message"
                  >
                    Show full
                  </button>
                )}
                {isLongMessage && !isCollapsed && (
                  <button
                    type="button"
                    onClick={() => setIsCollapsed(true)}
                    className="-mx-4 -mb-3 mt-2 w-[calc(100%+2rem)] border border-transparent py-2 bg-surface-2 text-center text-xs text-fg-subtle hover:bg-surface hover:text-accent transition-colors duration-150 focus-border-neutral"
                    aria-label="Collapse message"
                  >
                    Collapse
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {message.role === 'assistant' && message.runStatus === 'interrupted' && (
        <p className="mt-2 text-xs text-fg-muted italic">
          (run interrupted — server was restarted mid-response)
        </p>
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
          gatheringSources={gatheringSources}
          actionMessageId={actionMessageId}
          isPrivateSession={isPrivateSession}
          searchCapabilities={searchCapabilities}
        />
      )}
    </div>
  );
};

export default MessageBox;
