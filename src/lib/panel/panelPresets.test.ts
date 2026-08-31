import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  findMatchingPanelPreset,
  loadPanelPresets,
  panelPresetSummary,
  PANEL_PRESETS_KEY,
  type PanelPreset,
} from './panelPresets';
import type { PanelModelEntry } from './panelSelection';

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

const executors = (): PanelModelEntry[] => [
  { provider: 'openai', name: 'gpt-5.4' },
  { provider: 'anthropic', name: 'claude-opus-4-6' },
];

const preset = (entries = executors()): PanelPreset => ({
  id: 'panel-preset-1',
  name: 'Research panel',
  executors: entries,
  createdAt: 1,
});

describe('panel preset reasoning persistence', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('accepts old JSON and rejects malformed effort values', () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
    storage.setItem(
      PANEL_PRESETS_KEY,
      JSON.stringify([
        preset(),
        preset([
          {
            provider: 'openai',
            name: 'gpt-5.4',
            reasoningEffort: 'default' as never,
          },
          { provider: 'anthropic', name: 'claude-opus-4-6' },
        ]),
      ]),
    );

    expect(loadPanelPresets()).toEqual([preset()]);
  });

  it('includes non-default effort in summaries and preset matching', () => {
    const configured: PanelModelEntry[] = [
      { provider: 'openai', name: 'gpt-5.4', reasoningEffort: 'high' },
      {
        provider: 'anthropic',
        name: 'claude-opus-4-6',
        reasoningEffort: 'low',
      },
    ];
    const saved = preset(configured);

    expect(panelPresetSummary(saved)).toBe(
      '2 executors (gpt-5.4 · High, claude-opus-4-6 · Low)',
    );
    expect(findMatchingPanelPreset([saved], configured)).toBe(saved);
    expect(findMatchingPanelPreset([saved], executors())).toBeNull();
    expect(findMatchingPanelPreset([preset()], executors())).toMatchObject({
      id: 'panel-preset-1',
    });
  });
});
