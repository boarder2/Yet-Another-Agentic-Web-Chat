'use client';

import { useMemo, useState } from 'react';
import Speak from '@/components/MessageActions/Speak';
import ModelField from '@/components/models/ModelField';
import { useVoices } from '@/lib/hooks/api/useVoices';
import { useLocalStorageString } from '@/lib/hooks/useLocalStorage';
import SettingsSection from '../components/SettingsSection';
import { Field } from '@/components/ui/Field';
import Select from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';

type NarrationMode = 'read' | 'narrate';

const SAMPLE_TEXT =
  'The quick brown fox jumps over the lazy dog. This is how the selected voice sounds.';

type Engine = 'kokoro' | 'browser';

export default function VoiceSection() {
  const { data } = useVoices();
  // Reactive localStorage reads (DB-backed, synced by the settings persistence
  // layer) so the controls reflect changes made on another device on tab focus,
  // matching ImageGenerationSection. Raw string values are mapped to their typed
  // forms below.
  const [voice, setVoice] = useLocalStorageString('ttsVoice', '');
  const [engineRaw, setEngineRaw] = useLocalStorageString(
    'ttsEngine',
    'kokoro',
  );
  const engine: Engine = engineRaw === 'browser' ? 'browser' : 'kokoro';
  const [speedRaw, setSpeedRaw] = useLocalStorageString('ttsSpeed', '1');
  const speed = parseFloat(speedRaw) || 1.0;
  const [testText, setTestText] = useState('');
  const [narrationModeRaw, setNarrationModeRaw] = useLocalStorageString(
    'ttsNarrationMode',
    'read',
  );
  const narrationMode: NarrationMode =
    narrationModeRaw === 'narrate' ? 'narrate' : 'read';
  const [narrationProvider, setNarrationProvider] = useLocalStorageString(
    'ttsNarrationProvider',
    '',
  );
  const [narrationModelName, setNarrationModelName] = useLocalStorageString(
    'ttsNarrationModel',
    '',
  );
  const narrationModel = useMemo(
    () =>
      narrationProvider !== '' || narrationModelName !== ''
        ? { provider: narrationProvider, model: narrationModelName }
        : null,
    [narrationProvider, narrationModelName],
  );

  const handleVoiceChange = (value: string) => {
    setVoice(value);
  };

  const handleNarrationModeChange = (value: string) => {
    setNarrationModeRaw(value === 'narrate' ? 'narrate' : 'read');
  };

  const handleNarrationModelChange = (m: {
    provider: string;
    model: string;
  }) => {
    setNarrationProvider(m.provider);
    setNarrationModelName(m.model);
  };

  const handleEngineChange = (value: string) => {
    setEngineRaw(value === 'browser' ? 'browser' : 'kokoro');
  };

  const handleSpeedChange = (value: string) => {
    setSpeedRaw(String(parseFloat(value) || 1.0));
  };

  const selectedVoice = voice || data?.defaultVoice || '';

  const voiceOptions = (data?.voices ?? []).map((v) => ({
    value: v.id,
    label: `${v.name} · ${v.language === 'en-gb' ? 'British' : 'American'} ${v.gender}`,
  }));

  return (
    <SettingsSection title="Voice">
      <div className="flex flex-col space-y-4">
        <Field
          label="Read-aloud engine"
          hint={
            <>
              Neural runs a local model (higher quality, more latency/compute).
              System uses your device&apos;s built-in voices (instant, no
              download).
            </>
          }
        >
          <Select
            value={engine}
            onChange={(e) => handleEngineChange(e.target.value)}
            options={[
              { value: 'kokoro', label: 'Neural (local, higher quality)' },
              { value: 'browser', label: 'System (instant, built-in voices)' },
            ]}
          />
        </Field>
        {engine === 'kokoro' && (
          <>
            <Field
              label="Read-aloud voice"
              hint="Voice used by the local text-to-speech model when reading responses aloud."
            >
              <Select
                value={selectedVoice}
                onChange={(e) => handleVoiceChange(e.target.value)}
                options={voiceOptions}
                disabled={voiceOptions.length === 0}
              />
            </Field>
            <Field
              label="Playback speed"
              hint="Applied as the audio player's native playback rate, so it stays clear at any speed. Leave at 1× if you drive speed with a browser playback-speed extension instead."
            >
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
                  { value: '2.5', label: '2.5×' },
                  { value: '3', label: '3×' },
                ]}
              />
            </Field>
            <Field
              label="Narration mode"
              hint="Read speaks the response as written. Narrate uses an LLM to add spoken descriptions of tables, charts, and other visuals (cached per message; one model call per reply the first time it's read)."
            >
              <Select
                value={narrationMode}
                onChange={(e) => handleNarrationModeChange(e.target.value)}
                options={[
                  { value: 'read', label: 'Read (faithful, instant)' },
                  { value: 'narrate', label: 'Narrate (LLM descriptions)' },
                ]}
              />
            </Field>
            {narrationMode === 'narrate' && (
              <Field
                grouped
                label="Narration model"
                hint="Required for narration; otherwise reads aloud as-is."
                className="flex-row items-center justify-between"
              >
                <ModelField
                  selectedModel={narrationModel}
                  setSelectedModel={handleNarrationModelChange}
                  panelPosition="above"
                />
              </Field>
            )}
            <Field
              grouped
              label="Voice preview"
              hint="Type text to preview, or leave blank to use the sample."
              className="flex-row items-center gap-2"
            >
              <Input
                type="text"
                aria-label="Voice preview text"
                value={testText}
                onChange={(e) => setTestText(e.target.value)}
                placeholder={SAMPLE_TEXT}
                className="flex-1 rounded-surface"
              />
              <Speak
                text={testText.trim() || SAMPLE_TEXT}
                voice={selectedVoice}
                speed={speed}
                engine={engine}
              />
            </Field>
          </>
        )}
      </div>
    </SettingsSection>
  );
}
