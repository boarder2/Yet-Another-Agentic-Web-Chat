import Image from 'next/image';
import { ArrowRight, ArrowUp, LoaderCircle, Square, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import { File, ImageAttachment } from './ChatWindow';
import Attach from './MessageInputActions/Attach';
import ContextIndicator from './MessageInputActions/ContextIndicator';
import Focus from './MessageInputActions/Focus';
import ModelConfigurator from './MessageInputActions/ModelConfigurator';
import SystemPromptSelector from './MessageInputActions/SystemPromptSelector'; // Import new component
import MethodologySelector from './MessageInputActions/MethodologySelector';
import PersonalizationPicker from './PersonalizationPicker';

const MessageInput = ({
  sendMessage,
  loading,
  fileIds,
  setFileIds,
  files,
  setFiles,
  focusMode,
  setFocusMode,
  firstMessage,
  onCancel,
  systemPromptIds,
  setSystemPromptIds,
  sendLocation,
  setSendLocation,
  sendPersonalization,
  setSendPersonalization,
  personalizationLocation,
  personalizationAbout,
  refreshPersonalization,
  pendingImages,
  setPendingImages,
  imageCapable = false,
  initialMessage,
  onCancelEdit,
  isPrivateSession = false,
  selectedMethodologyId,
  setSelectedMethodologyId,
  estimatedUsage,
  messageCount,
  onCompact,
  compacting,
}: {
  sendMessage: (
    message: string,
    options?: {
      messageId?: string; // For rewrites/edits
      selectedSystemPromptIds?: string[];
    },
  ) => void;
  loading: boolean;
  fileIds: string[];
  setFileIds: (fileIds: string[]) => void;
  files: File[];
  setFiles: (files: File[]) => void;
  focusMode: string;
  setFocusMode: (mode: string) => void;
  firstMessage: boolean;
  onCancel?: () => void;
  systemPromptIds: string[];
  setSystemPromptIds: (ids: string[]) => void;
  sendLocation: boolean;
  setSendLocation: (value: boolean) => void;
  sendPersonalization: boolean;
  setSendPersonalization: (value: boolean) => void;
  personalizationLocation?: string;
  personalizationAbout?: string;
  refreshPersonalization?: () => void;
  pendingImages: ImageAttachment[];
  setPendingImages: (images: ImageAttachment[]) => void;
  imageCapable?: boolean;
  initialMessage?: string;
  onCancelEdit?: () => void;
  isPrivateSession?: boolean;
  selectedMethodologyId?: string | null;
  setSelectedMethodologyId?: (id: string | null) => void;
  estimatedUsage?: number;
  messageCount?: number;
  onCompact?: (instructions?: string) => void;
  compacting?: boolean;
}) => {
  const [message, setMessage] = useState(initialMessage || '');
  const [isUploadingImage, setIsUploadingImage] = useState(false);

  const uploadImageFiles = async (imageFiles: globalThis.File[]) => {
    if (imageFiles.length === 0) return;
    setIsUploadingImage(true);
    const formData = new FormData();
    imageFiles.forEach((f) => formData.append('images', f));
    try {
      const res = await fetch('/api/uploads/images', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (res.ok && data.images) {
        setPendingImages([...pendingImages, ...data.images]);
      }
    } catch (err) {
      console.error('Image upload failed:', err);
    }
    setIsUploadingImage(false);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (!imageCapable) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: globalThis.File[] = [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) imageFiles.push(file);
      }
    }
    if (imageFiles.length > 0) {
      e.preventDefault();
      uploadImageFiles(imageFiles);
    }
  };

  useEffect(() => {
    const storedPromptIds = localStorage.getItem('selectedSystemPromptIds');
    if (storedPromptIds) {
      try {
        const parsedIds = JSON.parse(storedPromptIds);
        if (Array.isArray(parsedIds)) {
          setSystemPromptIds(parsedIds);
        }
      } catch (e) {
        console.error(
          'Failed to parse selectedSystemPromptIds from localStorage',
          e,
        );
        localStorage.removeItem('selectedSystemPromptIds'); // Clear corrupted data
      }
    }
  }, [setSystemPromptIds]);

  useEffect(() => {
    if (systemPromptIds.length > 0) {
      localStorage.setItem(
        'selectedSystemPromptIds',
        JSON.stringify(systemPromptIds),
      );
    } else {
      // Remove from localStorage if no prompts are selected to keep it clean
      localStorage.removeItem('selectedSystemPromptIds');
    }
  }, [systemPromptIds]);

  useEffect(() => {
    if (setSelectedMethodologyId) {
      const stored = localStorage.getItem('selectedMethodologyId');
      if (stored) {
        setSelectedMethodologyId(stored);
      }
    }
  }, [setSelectedMethodologyId]);

  useEffect(() => {
    if (selectedMethodologyId) {
      localStorage.setItem('selectedMethodologyId', selectedMethodologyId);
    } else {
      localStorage.removeItem('selectedMethodologyId');
    }
  }, [selectedMethodologyId]);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeElement = document.activeElement;
      const isInputFocused =
        activeElement?.tagName === 'INPUT' ||
        activeElement?.tagName === 'TEXTAREA' ||
        activeElement?.hasAttribute('contenteditable');
      if (e.key === '/' && !isInputFocused) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Function to handle message submission
  const handleSubmitMessage = () => {
    // Only submit if we have a non-empty message or images, and not currently loading
    if (loading || (message.trim().length === 0 && pendingImages.length === 0))
      return;

    sendMessage(message);
    setMessage('');
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmitMessage();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          handleSubmitMessage();
        }
        if (e.key === 'Escape' && onCancelEdit) {
          e.preventDefault();
          onCancelEdit();
        }
      }}
      className="w-full"
    >
      <div className="flex flex-col bg-surface px-3 pt-4 pb-2 rounded-surface w-full border border-surface-2">
        {(pendingImages.length > 0 || isUploadingImage) && (
          <div className="flex flex-row gap-2 mb-2 overflow-x-auto pb-1">
            {pendingImages.map((img) => (
              <div key={img.imageId} className="relative shrink-0 group/thumb">
                <Image
                  src={`/api/uploads/images/${img.imageId}`}
                  alt={img.fileName}
                  width={80}
                  height={80}
                  className="h-20 w-20 object-cover rounded-surface border border-surface-2"
                />
                <button
                  type="button"
                  className="absolute -top-1.5 -right-1.5 bg-surface border border-surface-2 rounded-pill p-0.5 opacity-0 group-hover/thumb:opacity-100 transition-opacity"
                  onClick={() =>
                    setPendingImages(
                      pendingImages.filter((i) => i.imageId !== img.imageId),
                    )
                  }
                  aria-label={`Remove ${img.fileName}`}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            {isUploadingImage && (
              <div className="h-20 w-20 shrink-0 flex items-center justify-center rounded-surface border border-surface-2 bg-surface-2/50">
                <LoaderCircle size={20} className="animate-spin text-accent" />
              </div>
            )}
          </div>
        )}
        <div className="flex flex-row space-x-2 mb-2">
          <TextareaAutosize
            id="message-input"
            ref={inputRef}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onPaste={handlePaste}
            minRows={1}
            className="px-3 py-2 overflow-y-auto flex rounded-surface bg-transparent text-sm resize-none w-full max-h-24 lg:max-h-36 xl:max-h-48"
            placeholder={
              firstMessage
                ? 'What would you like to learn today?'
                : 'Ask a follow-up'
            }
            autoFocus={true}
          />
        </div>
        <div className="flex flex-row items-center justify-between">
          <div className="flex flex-row items-center space-x-2">
            <Focus focusMode={focusMode} setFocusMode={setFocusMode} />
            <Attach
              fileIds={fileIds}
              setFileIds={setFileIds}
              files={files}
              setFiles={setFiles}
              pendingImages={pendingImages}
              setPendingImages={setPendingImages}
              imageCapable={imageCapable}
            />
          </div>
          <div className="flex flex-row items-center space-x-2">
            <ModelConfigurator showModelName={false} />
            <SystemPromptSelector
              selectedPromptIds={systemPromptIds}
              onSelectedPromptIdsChange={setSystemPromptIds}
            />
            {focusMode !== 'chat' && setSelectedMethodologyId && (
              <MethodologySelector
                selectedMethodologyId={selectedMethodologyId ?? null}
                onSelectedMethodologyIdChange={setSelectedMethodologyId}
              />
            )}
            {!isPrivateSession && (
              <PersonalizationPicker
                hasLocation={personalizationLocation?.trim() !== ''}
                hasProfile={personalizationAbout?.trim() !== ''}
                sendLocation={sendLocation}
                setSendLocation={setSendLocation}
                sendPersonalization={sendPersonalization}
                setSendPersonalization={setSendPersonalization}
                locationPreview={personalizationLocation}
                profilePreview={personalizationAbout}
                onRefresh={refreshPersonalization}
              />
            )}
            {estimatedUsage !== undefined && onCompact && (
              <ContextIndicator
                chatModelContextWindow={parseInt(
                  typeof window !== 'undefined'
                    ? localStorage.getItem('contextWindowSize') || '32768'
                    : '32768',
                  10,
                )}
                estimatedUsage={estimatedUsage}
                messageCount={messageCount ?? 0}
                onCompact={onCompact}
                onChatContextSizeChange={(size) => {
                  localStorage.setItem('contextWindowSize', String(size));
                }}
                compacting={compacting}
              />
            )}
            {loading ? (
              <button
                type="button"
                className="bg-danger text-danger-fg hover:bg-danger transition duration-100 rounded-pill p-2 relative group"
                onClick={onCancel}
                aria-label="Cancel"
              >
                {loading && (
                  <LoaderCircle
                    size={20}
                    className="absolute inset-0 m-auto animate-spin text-fg/40"
                  />
                )}
                <span className="relative flex items-center justify-center w-4.25 h-4.25">
                  <Square size={17} className="text-danger-fg" />
                </span>
              </button>
            ) : (
              <>
                {onCancelEdit && (
                  <button
                    type="button"
                    onClick={onCancelEdit}
                    className="p-2 rounded-pill border border-surface-2 bg-surface hover:bg-surface-2 transition duration-200 text-fg/80"
                    aria-label="Cancel editing"
                  >
                    <X size={17} />
                  </button>
                )}
                <button
                  disabled={
                    message.trim().length === 0 && pendingImages.length === 0
                  }
                  className="bg-accent text-accent-fg disabled:text-accent-fg/50 disabled:bg-accent/20 hover:bg-accent-700 transition duration-100 rounded-pill p-2"
                  type="submit"
                >
                  {firstMessage ? (
                    <ArrowRight size={17} />
                  ) : (
                    <ArrowUp size={17} />
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </form>
  );
};

export default MessageInput;
