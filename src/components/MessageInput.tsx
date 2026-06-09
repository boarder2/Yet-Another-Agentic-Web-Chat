import Image from 'next/image';
import { ArrowRight, ArrowUp, LoaderCircle, Square, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import { useLocalStorageString } from '@/lib/hooks/useLocalStorage';
import { SELECTION_KEYS } from '@/lib/models/presets';
import { File, ImageAttachment } from './ChatWindow';
import Attach from './MessageInputActions/Attach';
import ContextIndicator from './MessageInputActions/ContextIndicator';
import Focus from './MessageInputActions/Focus';
import ModelConfigurator from './MessageInputActions/ModelConfigurator';
import SystemPromptSelector from './MessageInputActions/SystemPromptSelector'; // Import new component
import MethodologySelector from './MessageInputActions/MethodologySelector';
import AutoReadToggle from './MessageInputActions/AutoReadToggle';
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
  enabledSkills,
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
  enabledSkills?: Array<{ name: string; description: string }>;
}) => {
  const [message, setMessage] = useState(initialMessage || '');
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [contextWindowSizeStr] = useLocalStorageString(
    SELECTION_KEYS.contextWindowSize,
    '32768',
  );
  const [skillSuggestions, setSkillSuggestions] = useState<
    Array<{ name: string; description: string }>
  >([]);
  const [skillPopoverActive, setSkillPopoverActive] = useState(false);
  const [skillPopoverIndex, setSkillPopoverIndex] = useState(0);

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

  // Detect slash token at caret position and update skill suggestions
  const detectSlashToken = (
    text: string,
    cursorPos: number,
    skills: Array<{ name: string; description: string }>,
  ) => {
    // Find start of current token by scanning backwards from cursor
    const before = text.slice(0, cursorPos);
    const slashIdx = before.lastIndexOf('/');
    if (slashIdx === -1) {
      setSkillPopoverActive(false);
      return;
    }
    // Check that the char before '/' is start, whitespace, or newline
    const charBefore = slashIdx > 0 ? before[slashIdx - 1] : null;
    const validBefore =
      charBefore === null || charBefore === ' ' || charBefore === '\n';
    if (!validBefore) {
      setSkillPopoverActive(false);
      return;
    }
    // Make sure cursor is still inside the token (no space after slash)
    const tokenPart = before.slice(slashIdx + 1);
    if (/\s/.test(tokenPart)) {
      setSkillPopoverActive(false);
      return;
    }
    const token = tokenPart.toLowerCase();
    const matches = skills.filter((s) => s.name.startsWith(token));
    if (matches.length > 0) {
      setSkillSuggestions(matches);
      setSkillPopoverActive(true);
      setSkillPopoverIndex(0);
    } else {
      setSkillPopoverActive(false);
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setMessage(val);
    if (enabledSkills && enabledSkills.length > 0) {
      detectSlashToken(
        val,
        e.target.selectionStart ?? val.length,
        enabledSkills,
      );
    }
  };

  const applySkillCompletion = (skillName: string) => {
    // Replace the current /token with /skillName followed by a space
    const before = message.slice(
      0,
      inputRef.current?.selectionStart ?? message.length,
    );
    const slashIdx = before.lastIndexOf('/');
    const after = message.slice(
      inputRef.current?.selectionStart ?? message.length,
    );
    const newMessage =
      message.slice(0, slashIdx) + '/' + skillName + ' ' + after;
    setMessage(newMessage);
    setSkillPopoverActive(false);
    // Restore focus
    setTimeout(() => {
      if (inputRef.current) {
        const pos = slashIdx + skillName.length + 2; // +2 for '/' and ' '
        inputRef.current.focus();
        inputRef.current.setSelectionRange(pos, pos);
      }
    }, 0);
  };

  // Function to handle message submission
  const handleSubmitMessage = () => {
    // Only submit if we have a non-empty message or images, and not currently loading
    if (loading || (message.trim().length === 0 && pendingImages.length === 0))
      return;

    sendMessage(message);
    setMessage('');
    setSkillPopoverActive(false);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmitMessage();
      }}
      onKeyDown={(e) => {
        if (skillPopoverActive && skillSuggestions.length > 0) {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSkillPopoverIndex((i) => (i + 1) % skillSuggestions.length);
            return;
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSkillPopoverIndex(
              (i) =>
                (i - 1 + skillSuggestions.length) % skillSuggestions.length,
            );
            return;
          }
          if (e.key === 'Tab' || e.key === 'Enter') {
            e.preventDefault();
            applySkillCompletion(skillSuggestions[skillPopoverIndex].name);
            return;
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            setSkillPopoverActive(false);
            return;
          }
        }
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
      <div className="relative flex flex-col bg-surface px-3 pt-4 pb-2 rounded-surface w-full border border-surface-2">
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
        {/* Skill autocomplete popover */}
        {skillPopoverActive && skillSuggestions.length > 0 && (
          <div className="absolute bottom-full left-0 right-0 mb-1 border border-surface-2 rounded-control bg-surface shadow-raised overflow-hidden z-50">
            {skillSuggestions.slice(0, 6).map((skill, idx) => (
              <button
                key={skill.name}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  applySkillCompletion(skill.name);
                }}
                className={`w-full text-left px-3 py-2 text-sm flex flex-col gap-0.5 hover:bg-surface-2 transition-colors ${
                  idx === skillPopoverIndex ? 'bg-surface-2' : ''
                }`}
              >
                <span className="font-mono text-accent">/{skill.name}</span>
                <span className="text-xs text-fg/50">{skill.description}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-row space-x-2 mb-2">
          <TextareaAutosize
            id="message-input"
            ref={inputRef}
            value={message}
            onChange={handleTextareaChange}
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
                chatModelContextWindow={parseInt(contextWindowSizeStr, 10)}
                estimatedUsage={estimatedUsage}
                messageCount={messageCount ?? 0}
                onCompact={onCompact}
                compacting={compacting}
              />
            )}
            {!onCancelEdit && <AutoReadToggle />}
            {loading ? (
              <button
                type="button"
                className="bg-danger text-danger-fg hover:bg-danger transition duration-100 rounded-pill p-2 relative group"
                onClick={onCancel}
                aria-label="Cancel"
              >
                {loading && (
                  <LoaderCircle
                    size={40}
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-spin text-fg/40"
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
