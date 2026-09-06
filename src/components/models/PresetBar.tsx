import { useRef, useState } from 'react';
import { ExternalLink, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useSettingsModal } from '@/components/settings/SettingsModalProvider';
import { useLocalStorageJSON } from '@/lib/hooks/useLocalStorage';
import {
  PRESETS_KEY,
  PRESET_MAX,
  PRESET_NAME_MAX,
  type ModelPreset,
  type ModelPresetList,
  type ModelSelection,
  createPreset,
  findMatchingPreset,
  presetSummary,
  presetToSelection,
  selectionToActiveSelection,
  selectionToPresetInput,
  isPresetAvailable,
} from '@/lib/models/presets';
import { useModels } from '@/lib/hooks/api/useModels';
import PresetOption from './PresetOption';
import PresetPopover from './PresetPopover';

const EMPTY_PRESETS: ModelPresetList = [];

/**
 * Controlled preset switcher used by the unified `ModelPicker`. Applying a
 * preset emits a `ModelSelection` via `onApply` so non-localStorage callers
 * (scheduled tasks, widgets) can persist however they like; saving captures
 * the current `value`. `mode` controls whether the "Manage" link is shown
 * ('full', for chat) or omitted ('apply-save', for forms).
 */
export default function PresetBar({
  value,
  onApply,
  mode,
}: {
  value: ModelSelection;
  onApply: (sel: ModelSelection) => void;
  mode: 'full' | 'apply-save';
}) {
  const [presets, setPresetsState] = useLocalStorageJSON<ModelPresetList>(
    PRESETS_KEY,
    EMPTY_PRESETS,
  );

  const { data: modelsData } = useModels();
  const chatProviders = modelsData?.chatModelProviders as
    Record<string, Record<string, { displayName: string }>> | undefined;

  const [namingPreset, setNamingPreset] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const savingRef = useRef(false);
  const { openSettings } = useSettingsModal();

  const matchingPreset = findMatchingPreset(
    presets,
    selectionToActiveSelection(value),
  );

  const saveNewPreset = (close: () => void) => {
    if (savingRef.current) return;
    savingRef.current = true;
    const trimmedName = nameInput.trim().slice(0, PRESET_NAME_MAX);
    if (!trimmedName) {
      toast.error('Preset name cannot be empty');
      savingRef.current = false;
      return;
    }
    if (presets.length >= PRESET_MAX) {
      toast.error(`You can have at most ${PRESET_MAX} presets`);
      savingRef.current = false;
      return;
    }
    const newPreset = createPreset(selectionToPresetInput(value, trimmedName));
    setPresetsState([...presets, newPreset]);
    setNameInput('');
    setNamingPreset(false);
    toast.success(`Preset "${trimmedName}" saved`);
    savingRef.current = false;
    close();
  };

  const applyPreset = (preset: ModelPreset, close: () => void) => {
    onApply(presetToSelection(preset));
    toast.success(`Applied preset "${preset.name}"`);
    close();
  };

  const canSave = !!value.chatModel;

  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-fg">Presets</span>
      <PresetPopover
        triggerLabel={matchingPreset ? matchingPreset.name : 'Custom'}
        ariaLabel="Select preset"
        hasPresets={presets.length > 0}
        emptyBody="No presets yet. Save the current selection to create one."
        footer={({ close }) =>
          namingPreset ? (
            <div className="flex w-full items-center gap-1.5">
              <Input
                autoFocus
                type="text"
                aria-label="Preset name"
                maxLength={PRESET_NAME_MAX}
                placeholder="Preset name…"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveNewPreset(close);
                  if (e.key === 'Escape') {
                    setNamingPreset(false);
                    setNameInput('');
                  }
                }}
                className="min-w-0 flex-1 text-xs px-2 py-1"
              />
              <Button
                variant="primary"
                size="sm"
                onClick={() => saveNewPreset(close)}
                className="shrink-0"
              >
                Save
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setNamingPreset(false);
                  setNameInput('');
                }}
                className="shrink-0"
              >
                Cancel
              </Button>
            </div>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                disabled={!canSave}
                onClick={() => setNamingPreset(true)}
                className="px-0 py-0"
                title={
                  canSave
                    ? 'Save current selection as preset'
                    : 'Select a chat model first'
                }
              >
                Save current…
              </Button>
              {mode === 'full' && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={ExternalLink}
                  onClick={() => {
                    close();
                    openSettings('model-presets');
                  }}
                  className="px-0 py-0"
                >
                  Manage
                </Button>
              )}
            </>
          )
        }
      >
        {({ close }) =>
          presets.map((preset) => (
            <PresetOption
              key={preset.id}
              name={preset.name}
              summary={presetSummary(preset)}
              isActive={matchingPreset?.id === preset.id}
              available={isPresetAvailable(preset, chatProviders)}
              trailing={
                preset.imageCapable ? (
                  <Eye size={12} className="mt-0.5 shrink-0 text-fg-subtle" />
                ) : undefined
              }
              onClick={() => applyPreset(preset, close)}
            />
          ))
        }
      </PresetPopover>
    </div>
  );
}
