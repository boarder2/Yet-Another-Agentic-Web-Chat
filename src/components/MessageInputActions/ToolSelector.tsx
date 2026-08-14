import { Wrench, ChevronDown } from 'lucide-react';
import {
  Popover,
  PopoverButton,
  PopoverPanel,
  Transition,
} from '@headlessui/react';
import { Fragment, useEffect } from 'react';
import { useTools } from '@/lib/hooks/api/useTools';
import ComposerActionButton from '@/components/MessageInputActions/ComposerActionButton';
import ComposerOptionRow from '@/components/MessageInputActions/ComposerOptionRow';
import ComposerPopover from '@/components/MessageInputActions/ComposerPopover';

interface ToolSelectorProps {
  selectedToolNames: string[];
  onSelectedToolNamesChange: (names: string[]) => void;
}

const ToolSelector = ({
  selectedToolNames,
  onSelectedToolNamesChange,
}: ToolSelectorProps) => {
  const { data: availableTools = [], isLoading } = useTools();

  useEffect(() => {
    if (availableTools.length === 0) return;
    const availableToolNames = availableTools.map((t) => t.name);
    const validSelectedNames = selectedToolNames.filter((name) =>
      availableToolNames.includes(name),
    );
    if (validSelectedNames.length !== selectedToolNames.length) {
      onSelectedToolNamesChange(validSelectedNames);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableTools]);

  const handleToggleTool = (toolName: string) => {
    const newSelectedNames = selectedToolNames.includes(toolName)
      ? selectedToolNames.filter((name) => name !== toolName)
      : [...selectedToolNames, toolName];
    onSelectedToolNamesChange(newSelectedNames);
  };

  const selectedCount = selectedToolNames.length;

  return (
    <Popover className="relative">
      {({ open }) => (
        <>
          <PopoverButton
            as={ComposerActionButton}
            geometry="content"
            configured={selectedCount > 0}
            open={open}
            title="Select Tools"
          >
            <Wrench size={18} />
            {selectedCount > 0 ? <span> {selectedCount} </span> : null}
            <ChevronDown size={16} className="text-fg-subtle" />
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
            <PopoverPanel className="absolute z-20 w-72 transform bottom-full mb-2 overflow-hidden">
              <ComposerPopover
                title="Select Tools"
                description="Choose tools to assist the AI."
                loading={isLoading}
              >
                <div className="max-h-60 overflow-y-auto p-1.5 space-y-0.5">
                  {availableTools.length === 0 && (
                    <p className="text-xs text-fg-muted px-2.5 py-2 text-center">
                      No tools available.
                    </p>
                  )}

                  {availableTools.map((tool) => (
                    <ComposerOptionRow
                      key={tool.name}
                      selected={selectedToolNames.includes(tool.name)}
                      mode="check"
                      label={tool.name.replace(/_/g, ' ')}
                      description={tool.description}
                      title={tool.name}
                      onClick={() => handleToggleTool(tool.name)}
                    />
                  ))}
                </div>
              </ComposerPopover>
            </PopoverPanel>
          </Transition>
        </>
      )}
    </Popover>
  );
};

export default ToolSelector;
