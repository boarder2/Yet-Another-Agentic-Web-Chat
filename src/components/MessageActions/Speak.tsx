import { LoaderCircle, StopCircle, Volume2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSpeech } from 'react-text-to-speech';

type Status = 'idle' | 'loading' | 'playing';
type Engine = 'kokoro' | 'browser';

const readSpeed = () => {
  if (typeof window === 'undefined') return 1.0;
  return parseFloat(localStorage.getItem('ttsSpeed') || '') || 1.0;
};

/**
 * Speaker button backed by the local Kokoro TTS model (/api/tts), which streams
 * raw PCM sentence by sentence. Playback starts on the first chunk and the rest
 * are scheduled gap-free via the Web Audio API. Falls back to the browser's Web
 * Speech API if Kokoro is unavailable or the "browser" engine is selected.
 */
const Speak = ({
  text,
  voice: voiceProp,
  engine: engineProp,
  speed: speedProp,
}: {
  text: string;
  voice?: string;
  engine?: Engine;
  speed?: number;
}) => {
  const [status, setStatus] = useState<Status>('idle');
  const ctxRef = useRef<AudioContext | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(
    null,
  );
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const streamEndedRef = useRef(false);
  const stoppedRef = useRef(false);

  // Speed is read from a ref so the schedule closure always picks up the
  // value set at stream start.
  const speedRef = useRef(speedProp ?? readSpeed());

  // Browser-TTS fallback.
  const {
    speechStatus,
    start: startBrowser,
    stop: stopBrowser,
  } = useSpeech({ text });

  // Tear down the Web Audio graph and abort the network stream.
  const teardown = () => {
    readerRef.current?.cancel().catch(() => {});
    readerRef.current = null;
    sourcesRef.current.forEach((s) => {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    });
    sourcesRef.current.clear();
    if (ctxRef.current) {
      ctxRef.current.close().catch(() => {});
      ctxRef.current = null;
    }
  };

  useEffect(() => () => teardown(), []);

  const stop = () => {
    stoppedRef.current = true;
    teardown();
    stopBrowser();
    setStatus('idle');
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
    speedRef.current = speedProp ?? readSpeed();
    setStatus('loading');
    const voice =
      voiceProp ||
      (typeof window !== 'undefined' && localStorage.getItem('ttsVoice')) ||
      undefined;
    const speed = speedRef.current;

    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice, speed }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`TTS request failed: ${res.status}`);
      }
      if (stoppedRef.current) return;

      const sampleRate = Number(res.headers.get('X-Sample-Rate')) || 24000;
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      await ctx.resume();

      const reader = res.body.getReader();
      readerRef.current = reader;

      // Running timeline so each buffer is scheduled exactly after the previous.
      let nextTime = ctx.currentTime;
      let leftover = new Uint8Array(0);
      let started = false;
      streamEndedRef.current = false;

      const finalize = () => {
        if (stoppedRef.current) return;
        teardown();
        setStatus('idle');
      };

      const schedule = (samples: Float32Array<ArrayBuffer>) => {
        const buf = ctx.createBuffer(1, samples.length, sampleRate);
        buf.copyToChannel(samples, 0);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        const startAt = Math.max(nextTime, ctx.currentTime);
        src.start(startAt);
        nextTime = startAt + buf.duration;
        sourcesRef.current.add(src);
        src.onended = () => {
          sourcesRef.current.delete(src);
          if (streamEndedRef.current && sourcesRef.current.size === 0) {
            finalize();
          }
        };
      };

       
      while (true) {
        const { done, value } = await reader.read();
        if (stoppedRef.current) break;

        if (value && value.length > 0) {
          const combined = new Uint8Array(leftover.length + value.length);
          combined.set(leftover, 0);
          combined.set(value, leftover.length);
          const usableSamples = Math.floor(combined.length / 4);

          if (usableSamples > 0) {
            const usableBytes = usableSamples * 4;
            const ab = new ArrayBuffer(usableBytes);
            new Uint8Array(ab).set(combined.subarray(0, usableBytes));
            const samples = new Float32Array(ab);
            schedule(samples);
            leftover = combined.slice(usableSamples * 4);
            if (!started) {
              started = true;
              setStatus('playing');
            }
          } else {
            leftover = combined;
          }
        }

        if (done) break;
      }

      if (stoppedRef.current) return;

      // Flush any trailing partial samples from the final network read.
      if (leftover.length > 0) {
        const pad = (4 - (leftover.length % 4)) % 4;
        const padded = new Uint8Array(leftover.length + pad);
        padded.set(leftover);
        const samples = new Float32Array(padded.buffer);
        schedule(samples);
      }

      if (stoppedRef.current) return;

      streamEndedRef.current = true;
      if (sourcesRef.current.size === 0) {
        finalize();
      }
    } catch (err) {
      if (stoppedRef.current) return;
      console.warn('Kokoro TTS failed, using browser speech:', err);
      teardown();
      setStatus('idle');
      startBrowser();
    }
  };

  const isPlaying = status === 'playing' || speechStatus === 'started';
  const isLoading = status === 'loading';

  return (
    <button
      type="button"
      onClick={() => (isPlaying || isLoading ? stop() : start())}
      className="p-2 opacity-70 rounded-floating hover:bg-surface-2 transition duration-200"
      title={isPlaying ? 'Stop' : 'Read aloud'}
      aria-label={isPlaying ? 'Stop' : 'Read aloud'}
    >
      {isLoading ? (
        <LoaderCircle size={18} className="animate-spin" />
      ) : isPlaying ? (
        <StopCircle size={18} />
      ) : (
        <Volume2 size={18} />
      )}
    </button>
  );
};

export default Speak;
