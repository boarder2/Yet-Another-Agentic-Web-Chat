import { Link as LinkIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  type ModelSelection,
  DEFAULT_CONTEXT_WINDOW,
} from '@/lib/models/presets';
import ModelField from './ModelField';
import LinkToggle from './LinkToggle';
import VisionToggle from './VisionToggle';
import ContextWindowField from './ContextWindowField';
import PresetBar from './PresetBar';

export interface ModelPickerFields {
  system?: boolean;
  vision?: boolean;
  contextWindow?: boolean;
}

/**
 * The single, controlled model-selection component used everywhere models are
 * picked. It renders only the requested `fields`, enforces link behavior
 * (mirroring chat → system when linked, disabling the system field), and emits
 * a complete `ModelSelection` on every change. It owns no persistence — the
 * caller persists `onChange` however it likes. When `presets !== 'none'` it
 * renders the `PresetBar`.
 */
export default function ModelPicker({
  value,
  onChange,
  fields = {},
  presets = 'none',
  layout = 'inline',
}: {
  value: ModelSelection;
  onChange: (next: ModelSelection) => void;
  fields?: ModelPickerFields;
  presets?: 'full' | 'apply-save' | 'none';
  layout?: 'inline' | 'dialog';
}) {
  const panelPosition = layout === 'dialog' ? 'above' : 'below';
  const linked = value.linkSystemToChat;

  // Build a next selection from a patch, mirroring chat → system when linked.
  const emit = (patch: Partial<ModelSelection>) => {
    let next: ModelSelection = { ...value, ...patch };
    if (next.linkSystemToChat) {
      next = {
        ...next,
        systemProvider: next.chatProvider,
        systemModel: next.chatModel,
      };
    }
    onChange(next);
  };

  const chatModel =
    value.chatProvider && value.chatModel
      ? { provider: value.chatProvider, model: value.chatModel }
      : null;
  const systemModel =
    value.systemProvider && value.systemModel
      ? { provider: value.systemProvider, model: value.systemModel }
      : null;

  return (
    <div className="space-y-4">
      {presets !== 'none' && (
        <PresetBar value={value} onApply={onChange} mode={presets} />
      )}

      {fields.system && (
        <LinkToggle
          checked={linked}
          onChange={(checked) => emit({ linkSystemToChat: checked })}
        />
      )}

      {fields.vision && (
        <VisionToggle
          checked={value.imageCapable ?? false}
          onChange={(checked) => emit({ imageCapable: checked })}
        />
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs text-fg/70">Chat Model</span>
          <ModelField
            role="chat"
            selectedModel={chatModel}
            setSelectedModel={(m) =>
              emit({ chatProvider: m.provider, chatModel: m.model })
            }
            showModelName
            truncateModelName
            panelPosition={panelPosition}
          />
        </div>

        {fields.system && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs text-fg/70">System Model</span>
              {linked && (
                <span className="text-[10px] bg-surface px-2 py-0.5 rounded-control border border-surface-2 text-fg/60">
                  <LinkIcon size={14} />
                </span>
              )}
            </div>
            <div
              className={cn(
                'relative',
                linked ? 'opacity-60 pointer-events-none' : '',
              )}
            >
              <ModelField
                role="system"
                selectedModel={systemModel}
                setSelectedModel={(m) =>
                  emit({ systemProvider: m.provider, systemModel: m.model })
                }
                showModelName
                truncateModelName
                panelPosition={panelPosition}
              />
            </div>
          </div>
        )}

        {fields.contextWindow && (
          <ContextWindowField
            label="Context Window"
            value={value.contextWindowSize ?? DEFAULT_CONTEXT_WINDOW}
            onChange={(v) => emit({ contextWindowSize: v })}
          />
        )}
      </div>
    </div>
  );
}
