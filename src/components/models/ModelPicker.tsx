import {
  type ModelSelection,
  DEFAULT_CONTEXT_WINDOW,
} from '@/lib/models/presets';
import { useModels } from '@/lib/hooks/api/useModels';
import { clampReasoningEffort } from '@/lib/providers/reasoningEffort';
import ModelField from './ModelField';
import ReasoningEffortField from './ReasoningEffortField';
import VisionToggle from './VisionToggle';
import ContextWindowField from './ContextWindowField';
import PresetBar from './PresetBar';

export interface ModelPickerFields {
  system?: boolean;
  vision?: boolean;
  contextWindow?: boolean;
  /** Show native named-effort controls for the selected agent models. */
  reasoningEffort?: boolean;
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
  showStoredEffortState = false,
}: {
  value: ModelSelection;
  onChange: (next: ModelSelection) => void;
  fields?: ModelPickerFields;
  presets?: 'full' | 'apply-save' | 'none';
  layout?: 'inline' | 'dialog';
  /** Keep a saved stale effort visible in durable editors without rewriting it. */
  showStoredEffortState?: boolean;
}) {
  const panelPosition = layout === 'dialog' ? 'above' : 'below';
  const { data: modelsData, isFetched } = useModels();
  const capabilitiesLoaded = isFetched || modelsData !== undefined;
  const showReasoningEffort = fields.reasoningEffort !== false;

  const getSupportedEfforts = (provider: string, model: string) =>
    modelsData?.chatModelProviders[provider]?.[model]
      ?.supportedReasoningEfforts;

  const normalizeEffortForModel = (
    provider: string,
    model: string,
    effort: ModelSelection['chatReasoningEffort'],
  ) => {
    // Keep the stored value while the catalog is loading. The next model
    // selection will normalize it once capability metadata is available.
    if (!capabilitiesLoaded) return effort;
    return clampReasoningEffort(effort, getSupportedEfforts(provider, model));
  };

  // Build a next selection from a patch and emit it.
  const emit = (patch: Partial<ModelSelection>) => {
    onChange({ ...value, ...patch });
  };

  const selectModel = (
    role: 'chat' | 'system',
    model: { provider: string; model: string },
  ) => {
    if (role === 'chat') {
      emit({
        chatProvider: model.provider,
        chatModel: model.model,
        chatReasoningEffort: normalizeEffortForModel(
          model.provider,
          model.model,
          value.chatReasoningEffort,
        ),
      });
    } else {
      emit({
        systemProvider: model.provider,
        systemModel: model.model,
        systemReasoningEffort: normalizeEffortForModel(
          model.provider,
          model.model,
          value.systemReasoningEffort,
        ),
      });
    }
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
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-fg-muted">Chat Model</span>
            <ModelField
              role="chat"
              selectedModel={chatModel}
              setSelectedModel={(m) => selectModel('chat', m)}
              showModelName
              truncateModelName
              panelPosition={panelPosition}
            />
          </div>
          {showReasoningEffort && chatModel && (
            <ReasoningEffortField
              label="Chat reasoning effort"
              ariaLabel="Chat reasoning effort"
              value={value.chatReasoningEffort}
              supported={getSupportedEfforts(
                chatModel.provider,
                chatModel.model,
              )}
              capabilityKnown={capabilitiesLoaded}
              showStoredState={showStoredEffortState}
              onChange={(reasoningEffort) =>
                emit({ chatReasoningEffort: reasoningEffort })
              }
            />
          )}
        </div>

        {fields.system && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs text-fg-muted">System Model</span>
              <ModelField
                role="system"
                selectedModel={systemModel}
                setSelectedModel={(m) => selectModel('system', m)}
                showModelName
                truncateModelName
                panelPosition={panelPosition}
              />
            </div>
            {showReasoningEffort && systemModel && (
              <ReasoningEffortField
                label="System reasoning effort"
                ariaLabel="System reasoning effort"
                value={value.systemReasoningEffort}
                supported={getSupportedEfforts(
                  systemModel.provider,
                  systemModel.model,
                )}
                capabilityKnown={capabilitiesLoaded}
                showStoredState={showStoredEffortState}
                onChange={(reasoningEffort) =>
                  emit({ systemReasoningEffort: reasoningEffort })
                }
              />
            )}
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
