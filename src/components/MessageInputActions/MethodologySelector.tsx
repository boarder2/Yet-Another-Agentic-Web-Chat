import { FlaskConical, Circle, CircleDot, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  Popover,
  PopoverButton,
  PopoverPanel,
  Transition,
} from '@headlessui/react';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { Prompt } from '@/lib/types/prompt';

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
      <PopoverButton
        onClick={fetchMethodologies}
        className={cn(
          'flex items-center gap-1 rounded-lg text-sm transition-colors duration-150 ease-in-out focus:outline-none focus-visible:ring-2 p-1',
          selectedMethodologyId
            ? 'text-accent hover:text-accent'
            : 'text-fg/60 hover:text-fg/30',
        )}
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
        <PopoverPanel className="absolute right-0 z-20 w-72 transform bottom-full mb-2">
          <div className="overflow-hidden rounded-lg shadow-lg ring-1 ring-surface-2 bg-surface">
            <div className="px-4 py-3 border-b border-surface-2">
              <h3 className="text-sm font-medium text-fg/90">
                Research Methodology
              </h3>
              <p className="text-xs text-fg/60 mt-0.5">
                Control the research process - steps, priorities, and
                investigation structure.
              </p>
            </div>
            {isLoading ? (
              <div className="px-4 py-3">
                <Loader2 className="animate-spin text-fg/70" />
              </div>
            ) : (
              <div className="max-h-60 overflow-y-auto p-1.5 space-y-3">
                {/* No methodology option */}
                <div
                  onClick={() => handleSelect(null)}
                  className="flex items-center gap-2.5 p-2.5 rounded-md hover:bg-surface-2 cursor-pointer"
                >
                  {selectedMethodologyId === null ? (
                    <CircleDot
                      size={18}
                      className="text-accent flex-shrink-0"
                    />
                  ) : (
                    <Circle size={18} className="text-fg/40 flex-shrink-0" />
                  )}
                  <span className="text-sm text-fg/80">No methodology</span>
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
                          className="flex items-center gap-2.5 p-2.5 rounded-md hover:bg-surface-2 cursor-pointer"
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
                          className="flex items-center gap-2.5 p-2.5 rounded-md hover:bg-surface-2 cursor-pointer"
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
            )}
          </div>
        </PopoverPanel>
      </Transition>
    </Popover>
  );
};

export default MethodologySelector;
