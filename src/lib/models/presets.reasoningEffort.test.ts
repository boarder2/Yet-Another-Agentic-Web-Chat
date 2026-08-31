import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureCurrentSelection,
  findMatchingPreset,
  presetToSelection,
  presetSummary,
  selectionToActiveSelection,
  selectionToPresetInput,
  writeSelectionToStorage,
  type ModelPreset,
} from './presets';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

const basePreset = (overrides: Partial<ModelPreset> = {}): ModelPreset => ({
  id: 'preset-1',
  name: 'Reasoning preset',
  chatProvider: 'openai',
  chatModel: 'gpt-5.4',
  systemProvider: 'anthropic',
  systemModel: 'claude-opus-4-6',
  imageCapable: false,
  contextWindowSize: 32768,
  createdAt: 1,
  ...overrides,
});

describe('model preset reasoning persistence', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('round-trips independent role effort and includes it in the summary', () => {
    const p = basePreset({
      chatReasoningEffort: 'high',
      systemReasoningEffort: 'low',
    });
    const selection = presetToSelection(p);

    expect(selection).toMatchObject({
      chatReasoningEffort: 'high',
      systemReasoningEffort: 'low',
    });
    expect(selectionToPresetInput(selection, p.name)).toMatchObject({
      chatReasoningEffort: 'high',
      systemReasoningEffort: 'low',
    });
    expect(presetSummary(p)).toContain('chat: High · sys: Low');
  });

  it('matches effort as part of the preset identity and keeps old presets at default', () => {
    const legacy = basePreset();
    const configured = basePreset({ chatReasoningEffort: 'high' });
    const defaultSelection = selectionToActiveSelection(
      presetToSelection(legacy),
    );
    const configuredSelection = selectionToActiveSelection(
      presetToSelection(configured),
    );

    expect(findMatchingPreset([legacy], defaultSelection)).toBe(legacy);
    expect(findMatchingPreset([legacy], configuredSelection)).toBeNull();
    expect(findMatchingPreset([configured], configuredSelection)).toBe(
      configured,
    );
    expect(selectionToPresetInput(defaultSelection, 'old')).not.toHaveProperty(
      'chatReasoningEffort',
    );
  });

  it('syncs effort keys and removes both when Provider default is selected', () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);

    writeSelectionToStorage({
      chatProvider: 'openai',
      chatModel: 'gpt-5.4',
      systemProvider: 'anthropic',
      systemModel: 'claude-opus-4-6',
      chatReasoningEffort: 'high',
      systemReasoningEffort: 'off',
    });
    expect(captureCurrentSelection()).toMatchObject({
      chatReasoningEffort: 'high',
      systemReasoningEffort: 'off',
    });

    writeSelectionToStorage({
      chatProvider: 'openai',
      chatModel: 'gpt-5.4',
      systemProvider: 'anthropic',
      systemModel: 'claude-opus-4-6',
    });
    expect(captureCurrentSelection()).not.toHaveProperty('chatReasoningEffort');
    expect(captureCurrentSelection()).not.toHaveProperty(
      'systemReasoningEffort',
    );
  });
});
