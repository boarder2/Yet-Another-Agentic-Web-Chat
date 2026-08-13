import {
  FlaskConical,
  Circle,
  CircleDot,
  Settings as SettingsIcon,
} from 'lucide-react';
import {
  CloseButton,
  Popover,
  PopoverButton,
  PopoverPanel,
  Transition,
} from '@headlessui/react';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { Prompt } from '@/lib/types/prompt';
import { useSettingsModal } from '@/components/settings/SettingsModalProvider';
import ComposerActionButton from '@/components/MessageInputActions/ComposerActionButton';
import ComposerPopover from '@/components/MessageInputActions/ComposerPopover';

interface MethodologySelectorProps {
  selectedMethodologyId: string | null;
  onSelectedMethodologyIdChange: (id: string | null) => void;
}

const MethodologySelector = ({
  selectedMethodologyId,
  onSelectedMethodologyIdChange,
}: MethodologySelectorProps) => {
  const [availableMethodologies, setAvailableMethodologies] = useState<
    Prompt[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const { openSettings } = useSettingsModal();

  const fetchMethodologies = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/system-prompts?type=methodology');
      if (response.ok) {
        const methodologies = await response.json();
        setAvailableMethodologies(methodologies);
      }
    } catch (error) {
      console.error('Error loading methodologies:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Validate selection separately to avoid stale closure in fetchMethodologies
  useEffect(() => {
    if (
      selectedMethodologyId &&
      availableMethodologies.length > 0 &&
      !availableMethodologies.some((m) => m.id === selectedMethodologyId)
    ) {
      onSelectedMethodologyIdChange(null);
    }
  }, [
    selectedMethodologyId,
    availableMethodologies,
    onSelectedMethodologyIdChange,
  ]);

  const handleSelect = (id: string | null) => {
    onSelectedMethodologyIdChange(id);
  };

  const builtIn = availableMethodologies.filter((m) => m.readOnly);
  const custom = availableMethodologies.filter((m) => !m.readOnly);

  return (
    <Popover className="relative">
      {({ open }) => (
        <>
          <PopoverButton
            as={ComposerActionButton}
            geometry="compact"
            configured={Boolean(selectedMethodologyId)}
            open={open}
            onClick={fetchMethodologies}
            title="Select Research Methodology"
          >
            <FlaskConical size={18} />
          </PopoverButton>
          <Transition
            as={Fragment}
            enter="transition ease-out duration-200"
            enterFrom="opacity-0 translate-y-1"
            enterTo="opacity-100 translate-y-0"
            leave="transition ease-in duration-150"
            leaveFrom="opacity-100 translate-y-0"
            leaveTo="opacity-0 translate-y-1"
          >
            <PopoverPanel className="absolute right-0 z-20 w-72 transform bottom-full mb-2 overflow-hidden">
              <ComposerPopover
                title="Research Methodology"
                description="Control the research process - steps, priorities, and investigation structure."
                action={
                  <CloseButton
                    type="button"
                    onClick={() => openSettings('research-methodologies')}
                    className="text-xs inline-flex items-center gap-1 text-accent hover:underline shrink-0"
                    title="Manage research methodologies"
                  >
                    <SettingsIcon size={14} />
                  </CloseButton>
                }
                loading={isLoading}
              >
                <div className="max-h-60 overflow-y-auto p-1.5 space-y-3">
                  {/* Default (no methodology) option */}
                  <div
                    onClick={() => handleSelect(null)}
                    className="flex items-center gap-2.5 p-2.5 rounded-control hover:bg-surface-2 cursor-pointer"
                  >
                    {selectedMethodologyId === null ? (
                      <CircleDot
                        size={18}
                        className="text-accent flex-shrink-0"
                      />
                    ) : (
                      <Circle size={18} className="text-fg/40 flex-shrink-0" />
                    )}
                    <span className="text-sm text-fg/80">Default</span>
                  </div>

                  {builtIn.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-fg/70">
                        <FlaskConical size={14} />
                        <span>Built-in</span>
                      </div>
                      <div className="space-y-0.5">
                        {builtIn.map((methodology) => (
                          <div
                            key={methodology.id}
                            onClick={() => handleSelect(methodology.id)}
                            className="flex items-center gap-2.5 p-2.5 rounded-control hover:bg-surface-2 cursor-pointer"
                          >
                            {selectedMethodologyId === methodology.id ? (
                              <CircleDot
                                size={18}
                                className="text-accent flex-shrink-0"
                              />
                            ) : (
                              <Circle
                                size={18}
                                className="text-fg/40 flex-shrink-0"
                              />
                            )}
                            <span
                              className="text-sm text-fg/80 truncate"
                              title={methodology.name}
                            >
                              {methodology.name}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {custom.length > 0 && (
                    <div>
                      <div className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-fg/70">
                        <FlaskConical size={14} />
                        <span>Custom</span>
                      </div>
                      <div className="space-y-0.5">
                        {custom.map((methodology) => (
                          <div
                            key={methodology.id}
                            onClick={() => handleSelect(methodology.id)}
                            className="flex items-center gap-2.5 p-2.5 rounded-control hover:bg-surface-2 cursor-pointer"
                          >
                            {selectedMethodologyId === methodology.id ? (
                              <CircleDot
                                size={18}
                                className="text-accent flex-shrink-0"
                              />
                            ) : (
                              <Circle
                                size={18}
                                className="text-fg/40 flex-shrink-0"
                              />
                            )}
                            <span
                              className="text-sm text-fg/80 truncate"
                              title={methodology.name}
                            >
                              {methodology.name}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </ComposerPopover>
            </PopoverPanel>
          </Transition>
        </>
      )}
    </Popover>
  );
};

export default MethodologySelector;
