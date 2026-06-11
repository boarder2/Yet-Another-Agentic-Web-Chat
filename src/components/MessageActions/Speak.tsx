import { LoaderCircle, Pause, Play, Square, Volume2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSpeech } from 'react-text-to-speech';
import { toSpeechText } from '@/lib/utils/contentStripping';

type Status = 'idle' | 'loading' | 'playing' | 'paused';
type Engine = 'kokoro' | 'browser';
type Mode = 'read' | 'narrate';

// Offered by the inline speed selector (and Settings → Preferences).
const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3];

const readSpeed = () => {
  if (typeof window === 'undefined') return 1.0;
  return parseFloat(localStorage.getItem('ttsSpeed') || '') || 1.0;
};

const readMode = (): Mode =>
  typeof window !== 'undefined' &&
  localStorage.getItem('ttsNarrationMode') === 'narrate'
    ? 'narrate'
    : 'read';

const readNarrationModel = ():
  | { provider: string; name: string }
  | undefined => {
  if (typeof window === 'undefined') return undefined;
  const provider = localStorage.getItem('ttsNarrationProvider') || '';
  const name = localStorage.getItem('ttsNarrationModel') || '';
  return provider && name ? { provider, name } : undefined;
};

// Set preservesPitch (+ vendor prefixes) so speeding playback up doesn't raise
// pitch. Modern browsers default this to true, but older Safari/Firefox need the
// prefixed property set explicitly.
const setPreservesPitch = (el: HTMLAudioElement) => {
  const a = el as HTMLAudioElement & {
    preservesPitch?: boolean;
    webkitPreservesPitch?: boolean;
    mozPreservesPitch?: boolean;
  };
  a.preservesPitch = true;
  a.webkitPreservesPitch = true;
  a.mozPreservesPitch = true;
};

/**
 * Speaker button backed by the local Kokoro TTS model. POST /api/tts prepares the
 * speech segments and returns an id; a hidden in-DOM <audio> element then streams
 * the WAV from GET /api/tts/stream?id=... and plays it as it loads. Using a real
 * media element means the in-app speed applies as native playbackRate (high
 * quality at any rate) and browser playback-speed extensions work too. Falls back
 * to the browser's Web Speech API if Kokoro is unavailable or "browser" is selected.
 */
const Speak = ({
  text,
  markdown,
  messageId,
  voice: voiceProp,
  engine: engineProp,
  speed: speedProp,
  autoPlay = false,
}: {
  /** Plain text to speak (voice previews). Ignored when `markdown` is set. */
  text?: string;
  /** Rich message content; sent to the server for speechify/narration. */
  markdown?: string;
  messageId?: string;
  voice?: string;
  engine?: Engine;
  speed?: number;
  autoPlay?: boolean;
}) => {
  const [status, setStatus] = useState<Status>('idle');
  // Current playback rate, surfaced by the inline selector during playback.
  const [rate, setRate] = useState<number>(() => speedProp ?? readSpeed());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stoppedRef = useRef(false);
  // Latches the one-time fall back to browser speech so the start() catch and the
  // <audio> error listener can't both fire it (overlapping utterances).
  const fellBackRef = useRef(false);
  // Desired playback rate, re-applied after the resource loads (load resets it).
  const rateRef = useRef(1);

  // Plain text for the browser Web Speech engine / fallback (it can't take
  // markdown). Derived from `markdown` when present, else the `text` prop.
  const browserText = markdown ? toSpeechText(markdown) : (text ?? '');

  // Browser-TTS fallback. Its `start` doubles as resume when speechStatus is
  // 'paused' (it calls speechSynthesis.resume() internally).
  const {
    speechStatus,
    start: startBrowser,
    pause: pauseBrowser,
    stop: stopBrowser,
  } = useSpeech({ text: browserText });

  // Stop and detach the audio element so its in-flight stream is aborted.
  const teardown = () => {
    const el = audioRef.current;
    if (el) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
  };

  useEffect(() => () => teardown(), []);

  // Fall back to the OS Web Speech engine, at most once per playback attempt.
  const fallbackToBrowser = () => {
    if (fellBackRef.current) return;
    fellBackRef.current = true;
    teardown();
    setStatus('idle');
    startBrowser();
  };

  const stop = () => {
    stoppedRef.current = true;
    teardown();
    stopBrowser();
    setStatus('idle');
  };

  // Pause keeps the current position so playback can resume from the same spot —
  // the whole point of the <audio> element (the old Web Audio path couldn't).
  const pause = () => {
    if (status === 'playing') {
      audioRef.current?.pause();
      setStatus('paused');
    } else if (speechStatus === 'started') {
      pauseBrowser();
    }
  };

  const resume = () => {
    if (status === 'paused') {
      // The 'playing' event flips status back and re-applies the playback rate.
      audioRef.current?.play().catch(() => {});
    } else if (speechStatus === 'paused') {
      startBrowser(); // resumes from the paused position
    }
  };

  // Live speed change from the inline selector. Applies to the playing element
  // immediately and persists as the default (ttsSpeed) for next time — except in
  // the settings voice-preview, where the page owns the speed value via speedProp.
  const changeRate = (value: number) => {
    setRate(value);
    rateRef.current = value;
    if (audioRef.current) audioRef.current.playbackRate = value;
    if (speedProp === undefined && typeof window !== 'undefined') {
      localStorage.setItem('ttsSpeed', String(value));
    }
  };

  const start = async () => {
    const engine: Engine =
      engineProp ||
      (typeof window !== 'undefined' &&
        (localStorage.getItem('ttsEngine') as Engine)) ||
      'kokoro';

    // OS-level Web Speech API — no network/compute overhead.
    if (engine === 'browser') {
      startBrowser();
      return;
    }

    stoppedRef.current = false;
    fellBackRef.current = false;
    setStatus('loading');
    const voice =
      voiceProp ||
      (typeof window !== 'undefined' && localStorage.getItem('ttsVoice')) ||
      undefined;

    // Rich message content goes through speechify/narration server-side; the
    // voice-preview path sends plain `text`. Speed is no longer sent — synthesis
    // is always 1× and the client sets playbackRate below.
    const mode = readMode();
    const payload = markdown
      ? {
          markdown,
          messageId,
          mode,
          narrationModel: mode === 'narrate' ? readNarrationModel() : undefined,
          voice,
        }
      : { text, voice };

    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`TTS request failed: ${res.status}`);
      const { id } = (await res.json()) as { id?: string };
      if (!id) throw new Error('TTS prepare returned no id');
      if (stoppedRef.current) return;

      const el = audioRef.current;
      if (!el) throw new Error('audio element unavailable');

      setPreservesPitch(el);
      // Loading a new resource resets playbackRate to defaultPlaybackRate, so set
      // both — and re-apply on loadedmetadata/playing (see effect below). Re-read
      // the saved speed so the inline selector reflects any settings change.
      rateRef.current = speedProp ?? readSpeed();
      setRate(rateRef.current);
      el.defaultPlaybackRate = rateRef.current;
      el.playbackRate = rateRef.current;
      el.src = `/api/tts/stream?id=${encodeURIComponent(id)}`;
      await el.play();
      // Status transitions are driven by the element's events (see effect below).
    } catch (err) {
      if (stoppedRef.current) return;
      console.warn('Kokoro TTS failed, using browser speech:', err);
      fallbackToBrowser();
    }
  };

  // Drive status from the <audio> element's lifecycle.
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    // Re-assert the rate once the resource is loaded (load resets playbackRate).
    const applyRate = () => {
      setPreservesPitch(el);
      el.playbackRate = rateRef.current;
    };
    const onPlaying = () => {
      if (stoppedRef.current) return;
      applyRate();
      setStatus('playing');
    };
    const onEnded = () => {
      teardown();
      setStatus('idle');
    };
    const onError = () => {
      if (stoppedRef.current || !el.getAttribute('src')) return;
      console.warn('Kokoro TTS playback failed, using browser speech');
      fallbackToBrowser();
    };
    el.addEventListener('loadedmetadata', applyRate);
    el.addEventListener('playing', onPlaying);
    el.addEventListener('ended', onEnded);
    el.addEventListener('error', onError);
    return () => {
      el.removeEventListener('loadedmetadata', applyRate);
      el.removeEventListener('playing', onPlaying);
      el.removeEventListener('ended', onEnded);
      el.removeEventListener('error', onError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-start once when `autoPlay` turns on (e.g. a response just finished and
  // the user has auto-read enabled). Guarded so it fires a single time per
  // activation; resets when `autoPlay` clears so a rewrite can re-trigger.
  const autoStartedRef = useRef(false);
  const content = markdown ?? text ?? '';
  useEffect(() => {
    if (!autoPlay) {
      autoStartedRef.current = false;
      return;
    }
    if (autoStartedRef.current || !content.trim()) return;
    autoStartedRef.current = true;
    void start();
    // `start` is intentionally omitted — it's recreated each render and guarded
    // by autoStartedRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay, content]);

  const isLoading = status === 'loading';
  const isPlaying = status === 'playing' || speechStatus === 'started';
  const isPaused = status === 'paused' || speechStatus === 'paused';

  // Single toggle: load → pause (keeping position) → resume. A click during the
  // initial load cancels, since there's nothing to pause yet.
  const onClick = () => {
    if (isLoading) return stop();
    if (isPlaying) return pause();
    if (isPaused) return resume();
    return start();
  };

  const label = isLoading
    ? 'Stop'
    : isPlaying
      ? 'Pause'
      : isPaused
        ? 'Resume'
        : 'Read aloud';

  const isActive = isPlaying || isPaused;
  // The inline speed selector only applies to the local <audio> path; the OS Web
  // Speech engine can't change rate mid-utterance.
  const kokoroActive = status === 'playing' || status === 'paused';

  return (
    <div className="flex flex-row items-center gap-1">
      {/* In-DOM (not detached) so browser playback-speed extensions discover it. */}
      <audio ref={audioRef} hidden aria-label="Read-aloud audio" />
      <button
        type="button"
        onClick={onClick}
        className="p-2 opacity-70 rounded-floating hover:bg-surface-2 transition duration-200"
        title={label}
        aria-label={label}
      >
        {isLoading ? (
          <LoaderCircle size={18} className="animate-spin" />
        ) : isPlaying ? (
          <Pause size={18} />
        ) : isPaused ? (
          <Play size={18} />
        ) : (
          <Volume2 size={18} />
        )}
      </button>
      {isActive && (
        <button
          type="button"
          onClick={stop}
          className="p-2 opacity-70 rounded-floating hover:bg-surface-2 transition duration-200"
          title="Stop"
          aria-label="Stop"
        >
          <Square size={16} />
        </button>
      )}
      {kokoroActive && (
        <select
          value={String(rate)}
          onChange={(e) => changeRate(parseFloat(e.target.value))}
          className="bg-surface border border-surface-2 rounded-floating text-xs py-1 pl-1.5 pr-1 opacity-70 hover:opacity-100 cursor-pointer"
          title="Playback speed"
          aria-label="Playback speed"
        >
          {SPEED_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      )}
    </div>
  );
};

export default Speak;
