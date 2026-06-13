import {
  type ModelSelection,
  DEFAULT_CONTEXT_WINDOW,
} from '@/lib/models/presets';
import ModelField from './ModelField';
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
 * picked. It renders only the requested `fields` and emits a complete
 * `ModelSelection` on every change. It owns no persistence — the caller
 * persists `onChange` however it likes. When `presets !== 'none'` it renders
 * the `PresetBar`.
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

  // Build a next selection from a patch and emit it.
  const emit = (patch: Partial<ModelSelection>) => {
    onChange({ ...value, ...patch });
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
            <span className="text-xs text-fg/70">System Model</span>
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
