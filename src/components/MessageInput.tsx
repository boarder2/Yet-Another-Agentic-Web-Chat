import Image from 'next/image';
import {
  ArrowRight,
  ArrowUp,
  LoaderCircle,
  Square,
  TriangleAlert,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import { cn } from '@/lib/utils';
import { controlClasses } from '@/components/ui/Input';
import {
  subscribeLocalStorage,
  useLocalStorageString,
} from '@/lib/hooks/useLocalStorage';
import {
  DEFAULT_CONTEXT_WINDOW,
  SELECTION_KEYS,
  isModelRefAvailable,
} from '@/lib/models/presets';
import { useWorkspace } from '@/lib/hooks/api/useWorkspaces';
import { WORKSPACE_MODEL_UNAVAILABLE_MESSAGE } from '@/lib/workspaces/types';
import { useModels } from '@/lib/hooks/api/useModels';
import { File, ImageAttachment } from './ChatWindow';
import Attach from './MessageInputActions/Attach';
import ContextIndicator from './MessageInputActions/ContextIndicator';
import Focus from './MessageInputActions/Focus';
import ModelConfigurator from './MessageInputActions/ModelConfigurator';
import PanelSelector from './MessageInputActions/PanelSelector';
import SystemPromptSelector from './MessageInputActions/SystemPromptSelector'; // Import new component
import MethodologySelector from './MessageInputActions/MethodologySelector';
import AutoReadToggle from './MessageInputActions/AutoReadToggle';
import PersonalizationPicker from './PersonalizationPicker';
import TokenPopover from './TokenPopover';
import { useTokenAutocomplete } from '@/lib/hooks/useTokenAutocomplete';
import { useWorkspaceArtifacts } from '@/lib/hooks/api/useArtifacts';
import { buildArtifactMention } from '@/lib/artifacts/mention';
import { useArtifactBridge } from '@/lib/artifacts/ArtifactBridgeContext';

/** Shallow order-sensitive equality for the persona prompt ID list. */
const arraysEqual = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

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
  workspaceId,
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
  workspaceId?: string | null;
}) => {
  const { data: workspace } = useWorkspace(workspaceId);
  const modelOverride = workspace?.modelOverride ?? null;
  const { data: modelsData } = useModels();
  // When a workspace pins a model, the composer's model-derived affordances
  // (image attach/paste, context-usage meter) must follow the pin — the server
  // enforces its imageCapable/contextWindowSize, not the global selection.
  const effectiveImageCapable = modelOverride
    ? (modelOverride.imageCapable ?? false)
    : imageCapable;
  const pinInvalid =
    !!modelOverride &&
    (!isModelRefAvailable(
      modelOverride.chatProvider,
      modelOverride.chatModel,
      modelsData?.chatModelProviders,
    ) ||
      !isModelRefAvailable(
        modelOverride.systemProvider,
        modelOverride.systemModel,
        modelsData?.chatModelProviders,
      ));
  const [message, setMessage] = useState(initialMessage || '');
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [contextWindowSizeStr] = useLocalStorageString(
    SELECTION_KEYS.contextWindowSize,
    String(DEFAULT_CONTEXT_WINDOW),
  );
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
    if (!effectiveImageCapable) return;
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

  // Latest prop values, read inside the re-read handlers below to skip redundant
  // setter calls (and the write-back PATCH they trigger) when nothing changed.
  // Kept current via an effect (refs must not be mutated during render).
  const systemPromptIdsRef = useRef(systemPromptIds);
  const selectedMethodologyIdRef = useRef(selectedMethodologyId);
  useEffect(() => {
    systemPromptIdsRef.current = systemPromptIds;
    selectedMethodologyIdRef.current = selectedMethodologyId;
  });

  // Load persona prompt IDs from localStorage on mount, and re-read whenever the
  // cache changes from outside this component. This matters most for the
  // cross-device settings re-sync that runs on tab focus/visibility: it writes
  // the DB value into localStorage and fires the 'local-storage-change' wildcard
  // (cross-tab edits fire the native 'storage' event). Because this value lives
  // in ChatWindow's plain useState — not a reactive useLocalStorage* hook — it
  // would otherwise stay stale until a remount/full refresh.
  useEffect(() => {
    const readPromptIds = () => {
      const storedPromptIds = localStorage.getItem('selectedSystemPromptIds');
      if (!storedPromptIds) {
        // Absent (e.g. cleared on another device) → reflect the cleared state.
        if (systemPromptIdsRef.current.length > 0) setSystemPromptIds([]);
        return;
      }
      try {
        const parsedIds = JSON.parse(storedPromptIds);
        if (
          Array.isArray(parsedIds) &&
          !arraysEqual(systemPromptIdsRef.current, parsedIds)
        ) {
          setSystemPromptIds(parsedIds);
        }
      } catch (e) {
        console.error(
          'Failed to parse selectedSystemPromptIds from localStorage',
          e,
        );
        localStorage.removeItem('selectedSystemPromptIds'); // Clear corrupted data
      }
    };
    readPromptIds();
    return subscribeLocalStorage('selectedSystemPromptIds', readPromptIds);
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

  // Same as the persona prompt IDs above: re-read on external cache changes so
  // the focus-driven cross-device re-sync (and cross-tab edits) propagate to
  // ChatWindow's useState instead of only applying on a remount/full refresh.
  useEffect(() => {
    if (!setSelectedMethodologyId) return;
    const readMethodology = () => {
      const stored = localStorage.getItem('selectedMethodologyId');
      if (selectedMethodologyIdRef.current !== stored) {
        setSelectedMethodologyId(stored);
      }
    };
    readMethodology();
    return subscribeLocalStorage('selectedMethodologyId', readMethodology);
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

  const skills = useTokenAutocomplete({
    trigger: '/',
    items: enabledSkills ?? [],
    enabled: !!enabledSkills?.length,
    match: (s, q) => s.name.startsWith(q),
    describe: (s) => ({
      key: s.name,
      primary: `/${s.name}`,
      secondary: s.description,
    }),
    insertion: (s) => `/${s.name} `,
    message,
    setMessage,
    inputRef,
  });

  // Documents are only mentionable where they're durable: a workspace, and not
  // a private chat, where the artifact tools are withheld entirely.
  const mentionsEnabled = !!workspaceId && !isPrivateSession;
  const { data: workspaceArtifacts } = useWorkspaceArtifacts(
    mentionsEnabled ? workspaceId : null,
  );
  const mentions = useTokenAutocomplete({
    trigger: '@',
    items: workspaceArtifacts ?? [],
    enabled: mentionsEnabled,
    allowSpaces: true,
    match: (a, q) => a.title.toLowerCase().includes(q),
    describe: (a) => ({
      key: a.id,
      primary: a.title,
      secondary: `v${a.latestVersion}`,
    }),
    insertion: (a) => `${buildArtifactMention(a.id, a.title)} `,
    message,
    setMessage,
    inputRef,
  });

  // The sidebar's insert button drops a mention at the caret, exactly as the
  // popover would. Registered from here because the composer owns the text.
  const bridge = useArtifactBridge();
  const registerInsert = bridge?.registerInsert;
  useEffect(() => {
    if (!mentionsEnabled || !registerInsert) return;
    // Registration must not depend on the draft text: re-registering per
    // keystroke would set provider state and re-render the workspace on every
    // character. The current text comes from the setter instead.
    return registerInsert((artifactId, title) => {
      const caret = inputRef.current?.selectionStart;
      const token = `${buildArtifactMention(artifactId, title)} `;
      setMessage((cur) => {
        const at = caret ?? cur.length;
        setTimeout(() => {
          const pos = at + token.length;
          inputRef.current?.focus();
          inputRef.current?.setSelectionRange(pos, pos);
        }, 0);
        return cur.slice(0, at) + token + cur.slice(at);
      });
    });
  }, [mentionsEnabled, registerInsert]);

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setMessage(val);
    const caret = e.target.selectionStart ?? val.length;
    skills.onTextChange(val, caret);
    mentions.onTextChange(val, caret);
  };

  // Function to handle message submission
  const handleSubmitMessage = () => {
    // Only submit if we have a non-empty message or images, not currently
    // loading, and (when workspace-pinned) the pinned model is available.
    if (
      loading ||
      (message.trim().length === 0 && pendingImages.length === 0) ||
      pinInvalid
    )
      return;

    sendMessage(message);
    setMessage('');
    skills.close();
    mentions.close();
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmitMessage();
      }}
      onKeyDown={(e) => {
        // An open popover owns the arrows, Tab/Enter and Escape, so neither
        // submit nor cancel-edit fires while the user is picking a completion.
        if (skills.onKeyDown(e) || mentions.onKeyDown(e)) {
          e.preventDefault();
          return;
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
      {pinInvalid && (
        <div className="flex items-center gap-2 mb-2 px-3 py-2 rounded-control border border-warning bg-warning-soft text-warning dark:text-warning text-xs">
          <TriangleAlert size={14} className="shrink-0" />
          <span>{WORKSPACE_MODEL_UNAVAILABLE_MESSAGE}</span>
        </div>
      )}
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
        {skills.open && (
          <TokenPopover
            choices={skills.choices}
            activeIndex={skills.index}
            monospace
          />
        )}
        {mentions.open && (
          <TokenPopover
            choices={mentions.choices}
            activeIndex={mentions.index}
          />
        )}
        <div className="flex flex-row space-x-2 mb-2">
          <TextareaAutosize
            id="message-input"
            ref={inputRef}
            value={message}
            onChange={handleTextareaChange}
            onPaste={handlePaste}
            minRows={1}
            className={cn(
              'w-full',
              controlClasses,
              'overflow-y-auto flex resize-none max-h-24 lg:max-h-36 xl:max-h-48',
            )}
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
            <PanelSelector focusMode={focusMode} />
            <Attach
              fileIds={fileIds}
              setFileIds={setFileIds}
              files={files}
              setFiles={setFiles}
              pendingImages={pendingImages}
              setPendingImages={setPendingImages}
              imageCapable={effectiveImageCapable}
            />
          </div>
          <div className="flex flex-row items-center space-x-2">
            <ModelConfigurator
              showModelName={false}
              modelOverride={modelOverride}
            />
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
                chatModelContextWindow={
                  modelOverride?.contextWindowSize ??
                  parseInt(contextWindowSizeStr, 10)
                }
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
                    (message.trim().length === 0 &&
                      pendingImages.length === 0) ||
                    pinInvalid
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
