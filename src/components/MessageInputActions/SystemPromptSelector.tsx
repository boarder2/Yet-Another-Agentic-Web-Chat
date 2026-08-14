import {
  BookUser,
  CheckSquare,
  Square,
  User,
  Info,
  Settings as SettingsIcon,
} from 'lucide-react';
import {
  CloseButton,
  Popover,
  PopoverButton,
  PopoverPanel,
  Transition,
} from '@headlessui/react';
import { Fragment, useEffect, useState } from 'react';
import { Prompt } from '@/lib/types/prompt';
import { useSettingsModal } from '@/components/settings/SettingsModalProvider';
import ComposerActionButton from '@/components/MessageInputActions/ComposerActionButton';
import ComposerPopover from '@/components/MessageInputActions/ComposerPopover';

interface SystemPromptSelectorProps {
  selectedPromptIds: string[];
  onSelectedPromptIdsChange: (ids: string[]) => void;
}

const SystemPromptSelector = ({
  selectedPromptIds,
  onSelectedPromptIdsChange,
}: SystemPromptSelectorProps) => {
  const selectedCount = selectedPromptIds.length;

  return (
    <Popover className="relative">
      {({ open }) => (
        <>
          <PopoverButton
            as={ComposerActionButton}
            geometry={selectedCount > 0 ? 'content' : 'compact'}
            configured={selectedCount > 0}
            open={open}
            title="Select Prompts"
          >
            <BookUser size={18} />
            {selectedCount > 0 ? <span> {selectedCount} </span> : null}
            {/* <ChevronDown size={16} className="text-fg-subtle" /> */}
          </PopoverButton>
          <Transition
            as={Fragment}
            enter="transition-[opacity,transform] ease-out duration-200"
            enterFrom="opacity-0 translate-y-1"
            enterTo="opacity-100 translate-y-0"
            leave="transition-[opacity,transform] ease-in duration-150"
            leaveFrom="opacity-100 translate-y-0"
            leaveTo="opacity-0 translate-y-1"
          >
            <PopoverPanel className="absolute right-0 z-20 w-72 transform bottom-full mb-2 overflow-hidden">
              <PromptPanel
                open={open}
                selectedPromptIds={selectedPromptIds}
                onSelectedPromptIdsChange={onSelectedPromptIdsChange}
              />
            </PopoverPanel>
          </Transition>
        </>
      )}
    </Popover>
  );
};

interface PromptPanelProps extends SystemPromptSelectorProps {
  open: boolean;
}

const PromptPanel = ({
  open,
  selectedPromptIds,
  onSelectedPromptIdsChange,
}: PromptPanelProps) => {
  const [availablePrompts, setAvailablePrompts] = useState<Prompt[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { openSettings } = useSettingsModal();

  useEffect(() => {
    if (!open) return; // Only fetch when popover is open
    const fetchPrompts = async () => {
      try {
        setIsLoading(true);
        const response = await fetch('/api/system-prompts');
        if (response.ok) {
          const prompts = await response.json();
          setAvailablePrompts(prompts);

          // Check if any currently selected prompt IDs are not in the API response
          const availablePromptIds = prompts.map((prompt: Prompt) => prompt.id);
          const validSelectedIds = selectedPromptIds.filter((id) =>
            availablePromptIds.includes(id),
          );

          // If some selected IDs are no longer available, update the selection
          if (validSelectedIds.length !== selectedPromptIds.length) {
            onSelectedPromptIdsChange(validSelectedIds);
          }
        } else {
          console.error('Failed to load system prompts.');
        }
      } catch (error) {
        console.error('Error loading system prompts.');
        console.error(error);
      } finally {
        setIsLoading(false);
      }
    };
    fetchPrompts();
  }, [open, selectedPromptIds, onSelectedPromptIdsChange]);

  const handleTogglePrompt = (promptId: string) => {
    const newSelectedIds = selectedPromptIds.includes(promptId)
      ? selectedPromptIds.filter((id) => id !== promptId)
      : [...selectedPromptIds, promptId];
    onSelectedPromptIdsChange(newSelectedIds);
  };

  return (
    <ComposerPopover
      title="Persona Prompts"
      description="Control response tone, style, and formatting."
      action={
        <CloseButton
          type="button"
          onClick={() => openSettings('persona-prompts')}
          className="inline-flex items-center gap-1 border border-transparent text-xs text-accent hover:underline shrink-0 focus-border-neutral"
          title="Manage persona prompts"
          aria-label="Manage persona prompts"
        >
          <SettingsIcon size={14} />
        </CloseButton>
      }
      loading={isLoading}
    >
      <div className="max-h-60 overflow-y-auto p-1.5 space-y-3">
        {availablePrompts.length === 0 && (
          <p className="text-xs text-fg-muted px-2.5 py-2 text-center">
            No prompts configured. <br /> Go to{' '}
            <CloseButton
              type="button"
              className="border border-transparent text-accent focus-border-neutral"
              onClick={() => openSettings('persona-prompts')}
            >
              settings
            </CloseButton>{' '}
            to add some.
          </p>
        )}

        {availablePrompts.filter((p) => p.type === 'persona' && p.readOnly)
          .length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-fg-muted">
              <User size={14} />
              <div className="flex items-center gap-1.5">
                <span>Default Prompts</span>
                <Popover>
                  <PopoverButton
                    className="border border-transparent focus-border-neutral"
                    aria-label="About default prompts"
                  >
                    <Info
                      size={14}
                      className="text-fg-subtle hover:text-fg-muted"
                    />
                  </PopoverButton>
                  <Transition
                    as={Fragment}
                    enter="transition-[opacity,transform] ease-out duration-200"
                    enterFrom="opacity-0 translate-y-1"
                    enterTo="opacity-100 translate-y-0"
                    leave="transition-[opacity,transform] ease-in duration-150"
                    leaveFrom="opacity-100 translate-y-0"
                    leaveTo="opacity-0 translate-y-1"
                  >
                    <PopoverPanel className="absolute z-30 w-64 p-3 bg-surface border border-surface-2 rounded-surface shadow-raised text-xs text-fg-muted">
                      Built-in formatting and citation presets. The system
                      auto-selects one based on focus mode when no persona
                      prompt is active. Select one here to override the default,
                      or combine with your own persona prompts.
                    </PopoverPanel>
                  </Transition>
                </Popover>
              </div>
            </div>
            <div className="space-y-0.5">
              {availablePrompts
                .filter((p) => p.type === 'persona' && p.readOnly)
                .map((prompt) => (
                  <div
                    key={prompt.id}
                    onClick={() => handleTogglePrompt(prompt.id)}
                    className="flex items-center gap-2.5 p-2.5 rounded-control hover:bg-surface-2 cursor-pointer"
                  >
                    {selectedPromptIds.includes(prompt.id) ? (
                      <CheckSquare
                        size={18}
                        className="text-accent flex-shrink-0"
                      />
                    ) : (
                      <Square
                        size={18}
                        className="text-fg-subtle flex-shrink-0"
                      />
                    )}
                    <span
                      className="text-sm text-fg truncate"
                      title={prompt.name}
                    >
                      {prompt.name}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {availablePrompts.filter((p) => p.type === 'persona' && !p.readOnly)
          .length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-fg-muted">
              <User size={14} />
              <span>Persona Prompts</span>
            </div>
            <div className="space-y-0.5">
              {availablePrompts
                .filter((p) => p.type === 'persona' && !p.readOnly)
                .map((prompt) => (
                  <div
                    key={prompt.id}
                    onClick={() => handleTogglePrompt(prompt.id)}
                    className="flex items-center gap-2.5 p-2.5 rounded-control hover:bg-surface-2 cursor-pointer"
                  >
                    {selectedPromptIds.includes(prompt.id) ? (
                      <CheckSquare
                        size={18}
                        className="text-accent flex-shrink-0"
                      />
                    ) : (
                      <Square
                        size={18}
                        className="text-fg-subtle flex-shrink-0"
                      />
                    )}
                    <span
                      className="text-sm text-fg truncate"
                      title={prompt.name}
                    >
                      {prompt.name}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}
      </div>
    </ComposerPopover>
  );
};

export default SystemPromptSelector;
