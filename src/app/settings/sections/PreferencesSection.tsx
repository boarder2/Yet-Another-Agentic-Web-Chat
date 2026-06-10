'use client';

import { useState } from 'react';
import ThemeSwitcher from '@/components/theme/Switcher';
import Speak from '@/components/MessageActions/Speak';
import ModelField from '@/components/models/ModelField';
import { useVoices } from '@/lib/hooks/api/useVoices';
import SettingsSection from '../components/SettingsSection';
import Select from '../components/Select';

type NarrationMode = 'read' | 'narrate';

const SAMPLE_TEXT =
  'The quick brown fox jumps over the lazy dog. This is how the selected voice sounds.';

type Engine = 'kokoro' | 'browser';

export default function PreferencesSection() {
  const { data } = useVoices();
  const [voice, setVoice] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('ttsVoice') || '' : '',
  );
  const [engine, setEngine] = useState<Engine>(() =>
    typeof window !== 'undefined' &&
    localStorage.getItem('ttsEngine') === 'browser'
      ? 'browser'
      : 'kokoro',
  );
  const [speed, setSpeed] = useState(() =>
    typeof window !== 'undefined'
      ? parseFloat(localStorage.getItem('ttsSpeed') || '') || 1.0
      : 1.0,
  );
  const [testText, setTestText] = useState('');
  const [narrationMode, setNarrationMode] = useState<NarrationMode>(() =>
    typeof window !== 'undefined' &&
    localStorage.getItem('ttsNarrationMode') === 'narrate'
      ? 'narrate'
      : 'read',
  );
  const [narrationModel, setNarrationModel] = useState<{
    provider: string;
    model: string;
  } | null>(() => {
    if (typeof window === 'undefined') return null;
    const provider = localStorage.getItem('ttsNarrationProvider') || '';
    const model = localStorage.getItem('ttsNarrationModel') || '';
    return provider && model ? { provider, model } : null;
  });

  const handleVoiceChange = (value: string) => {
    setVoice(value);
    localStorage.setItem('ttsVoice', value);
  };

  const handleNarrationModeChange = (value: string) => {
    const next: NarrationMode = value === 'narrate' ? 'narrate' : 'read';
    setNarrationMode(next);
    localStorage.setItem('ttsNarrationMode', next);
  };

  const handleNarrationModelChange = (m: {
    provider: string;
    model: string;
  }) => {
    setNarrationModel(m);
    localStorage.setItem('ttsNarrationProvider', m.provider);
    localStorage.setItem('ttsNarrationModel', m.model);
  };

  const handleEngineChange = (value: string) => {
    const next: Engine = value === 'browser' ? 'browser' : 'kokoro';
    setEngine(next);
    localStorage.setItem('ttsEngine', next);
  };

  const handleSpeedChange = (value: string) => {
    const s = parseFloat(value) || 1.0;
    setSpeed(s);
    localStorage.setItem('ttsSpeed', String(s));
  };

  const selectedVoice = voice || data?.defaultVoice || '';

  const voiceOptions = (data?.voices ?? []).map((v) => ({
    value: v.id,
    label: `${v.name} · ${v.language === 'en-gb' ? 'British' : 'American'} ${v.gender}`,
  }));

  return (
    <SettingsSection title="Preferences">
      <div className="flex flex-col space-y-4">
        <div className="flex flex-col space-y-1">
          <p className="text-sm">Theme</p>
          <ThemeSwitcher />
        </div>
        <div className="flex flex-col space-y-1">
          <p className="text-sm">Read-aloud engine</p>
          <p className="text-xs opacity-70">
            Neural runs a local model (higher quality, more latency/compute).
            System uses your device&apos;s built-in voices (instant, no
            download).
          </p>
          <Select
            value={engine}
            onChange={(e) => handleEngineChange(e.target.value)}
            options={[
              { value: 'kokoro', label: 'Neural (local, higher quality)' },
              { value: 'browser', label: 'System (instant, built-in voices)' },
            ]}
          />
        </div>
        {engine === 'kokoro' && (
          <div className="flex flex-col space-y-1">
            <p className="text-sm">Read-aloud voice</p>
            <p className="text-xs opacity-70">
              Voice used by the local text-to-speech model when reading
              responses aloud.
            </p>
            <Select
              value={selectedVoice}
              onChange={(e) => handleVoiceChange(e.target.value)}
              options={voiceOptions}
              disabled={voiceOptions.length === 0}
            />
            <div className="flex flex-col space-y-1 pt-2">
              <p className="text-sm">Playback speed</p>
              <Select
                value={String(speed)}
                onChange={(e) => handleSpeedChange(e.target.value)}
                options={[
                  { value: '0.5', label: '0.5×' },
                  { value: '0.75', label: '0.75×' },
                  { value: '1', label: '1× (normal)' },
                  { value: '1.25', label: '1.25×' },
                  { value: '1.5', label: '1.5×' },
                  { value: '2', label: '2×' },
                ]}
              />
            </div>
            <div className="flex flex-col space-y-1 pt-2">
              <p className="text-sm">Narration mode</p>
              <p className="text-xs opacity-70">
                Read speaks the response as written. Narrate uses an LLM to add
                spoken descriptions of tables, charts, and other visuals (cached
                per message; one model call per reply the first time it&apos;s
                read).
              </p>
              <Select
                value={narrationMode}
                onChange={(e) => handleNarrationModeChange(e.target.value)}
                options={[
                  { value: 'read', label: 'Read (faithful, instant)' },
                  { value: 'narrate', label: 'Narrate (LLM descriptions)' },
                ]}
              />
              {narrationMode === 'narrate' && (
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs opacity-70">
                    Narration model{' '}
                    <span className="opacity-60">
                      (defaults to the system model)
                    </span>
                  </span>
                  <ModelField
                    selectedModel={narrationModel}
                    setSelectedModel={handleNarrationModelChange}
                    panelPosition="above"
                  />
                </div>
              )}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={testText}
                onChange={(e) => setTestText(e.target.value)}
                placeholder={SAMPLE_TEXT}
                aria-label="Voice preview text"
                className="flex-1 bg-surface px-3 py-2 border border-surface-2 rounded-surface text-sm placeholder:opacity-60"
              />
              <Speak
                text={testText.trim() || SAMPLE_TEXT}
                voice={selectedVoice}
                speed={speed}
                engine={engine}
              />
            </div>
            <p className="text-xs opacity-70">
              Type text to preview, or leave blank to use the sample.
            </p>
          </div>
        )}
      </div>
    </SettingsSection>
  );
}
