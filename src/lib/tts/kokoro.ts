// Kokoro-82M ONNX model. Downloads (~160MB at q8) into the transformers.js cache
// on first use, then runs fully offline on CPU — same mechanism as the embedding
// model in src/lib/huggingfaceTransformer.ts.
import type { SpeechSegment } from './speechify';

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';

export interface VoiceInfo {
  id: string;
  name: string;
  language: string;
  gender: string;
}

// Fixed voicepacks shipped with Kokoro-82M v1.0 (kokoro-js does not export this
// list from its entrypoint, so we mirror it here). Highest-quality voices first.
export const VOICE_LIST: VoiceInfo[] = [
  { id: 'af_heart', name: 'Heart', language: 'en-us', gender: 'Female' },
  { id: 'af_bella', name: 'Bella', language: 'en-us', gender: 'Female' },
  { id: 'af_nicole', name: 'Nicole', language: 'en-us', gender: 'Female' },
  { id: 'bf_emma', name: 'Emma', language: 'en-gb', gender: 'Female' },
  { id: 'af_aoede', name: 'Aoede', language: 'en-us', gender: 'Female' },
  { id: 'af_kore', name: 'Kore', language: 'en-us', gender: 'Female' },
  { id: 'af_sarah', name: 'Sarah', language: 'en-us', gender: 'Female' },
  { id: 'af_alloy', name: 'Alloy', language: 'en-us', gender: 'Female' },
  { id: 'af_nova', name: 'Nova', language: 'en-us', gender: 'Female' },
  { id: 'af_sky', name: 'Sky', language: 'en-us', gender: 'Female' },
  { id: 'af_jessica', name: 'Jessica', language: 'en-us', gender: 'Female' },
  { id: 'af_river', name: 'River', language: 'en-us', gender: 'Female' },
  { id: 'am_fenrir', name: 'Fenrir', language: 'en-us', gender: 'Male' },
  { id: 'am_michael', name: 'Michael', language: 'en-us', gender: 'Male' },
  { id: 'am_puck', name: 'Puck', language: 'en-us', gender: 'Male' },
  { id: 'am_echo', name: 'Echo', language: 'en-us', gender: 'Male' },
  { id: 'am_eric', name: 'Eric', language: 'en-us', gender: 'Male' },
  { id: 'am_liam', name: 'Liam', language: 'en-us', gender: 'Male' },
  { id: 'am_onyx', name: 'Onyx', language: 'en-us', gender: 'Male' },
  { id: 'am_adam', name: 'Adam', language: 'en-us', gender: 'Male' },
  { id: 'am_santa', name: 'Santa', language: 'en-us', gender: 'Male' },
  { id: 'bf_isabella', name: 'Isabella', language: 'en-gb', gender: 'Female' },
  { id: 'bf_alice', name: 'Alice', language: 'en-gb', gender: 'Female' },
  { id: 'bf_lily', name: 'Lily', language: 'en-gb', gender: 'Female' },
  { id: 'bm_george', name: 'George', language: 'en-gb', gender: 'Male' },
  { id: 'bm_fable', name: 'Fable', language: 'en-gb', gender: 'Male' },
  { id: 'bm_daniel', name: 'Daniel', language: 'en-gb', gender: 'Male' },
  { id: 'bm_lewis', name: 'Lewis', language: 'en-gb', gender: 'Male' },
];

export const DEFAULT_VOICE = 'af_heart';

const VOICE_IDS = new Set(VOICE_LIST.map((v) => v.id));

export const isValidVoice = (voice: string): boolean => VOICE_IDS.has(voice);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ttsPromise: Promise<any> | undefined;

const getTTS = async () => {
  const { KokoroTTS } = await import('kokoro-js');
  return (ttsPromise ??= KokoroTTS.from_pretrained(MODEL_ID, {
    dtype: 'q4',
    device: 'cpu',
  }));
};

/** Kokoro outputs 24kHz mono audio. */
export const SAMPLE_RATE = 24000;

/**
 * Synthesize speech, yielding raw 32-bit float PCM samples one sentence at a time.
 *
 * Kokoro has a limited input length (~510 phoneme tokens) per forward pass, so a
 * single generate() call truncates long text. The streaming API splits the text
 * into sentences; yielding each chunk lets the client start playback on the first
 * sentence while the rest keep generating. The model is loaded once and cached.
 */
export async function* synthesizeStream(
  text: string,
  voice: string = DEFAULT_VOICE,
  speed: number = 1,
): AsyncGenerator<Float32Array> {
  const tts = await getTTS();
  const { TextSplitterStream } = await import('kokoro-js');
  const splitter = new TextSplitterStream();
  splitter.push(text);
  splitter.close();
  let i = 0;
  for await (const chunk of tts.stream(splitter, {
    voice: isValidVoice(voice) ? voice : DEFAULT_VOICE,
    speed,
  })) {
    i++;
    // The yielded RawAudio is backed by WASM tensors whose buffers can be
    // detached after the next forward pass. Copy into a plain Float32Array
    // with an owned ArrayBuffer before yielding.
    const { audio: raw } = chunk as {
      audio: { data: Float32Array; audio: Float32Array | Float32Array[] };
    };
    let src: Float32Array | null = null;
    try {
      src = raw.data;
    } catch (e) {
      console.warn(`[kokoro] chunk ${i}: raw.data threw`, e);
    }
    if (!src || src.length === 0) {
      src = Array.isArray(raw.audio) ? raw.audio[0] : raw.audio;
    }
    if (!src || src.length === 0) {
      console.warn(
        `[kokoro] chunk ${i}: no audio data (text="${chunk.text?.slice(0, 60)}")`,
      );
      continue; // skip empty chunk, don't hang
    }
    console.log(
      `[kokoro] chunk ${i}: ${src.length} samples, text="${chunk.text?.slice(0, 60)}"`,
    );
    yield new Float32Array(src);
  }
  console.log(`[kokoro] stream done — ${i} chunks total`);
}

/**
 * Number of zero-valued samples to represent `pauseAfterMs` of silence at the
 * model's sample rate, scaled by playback speed so a pause feels the same length
 * regardless of how fast speech plays (a 500ms gap at 2× would otherwise drag).
 */
export const silenceSampleCount = (
  pauseAfterMs: number,
  speed: number,
): number =>
  Math.max(0, Math.round(((pauseAfterMs / 1000) * SAMPLE_RATE) / (speed || 1)));

/**
 * Synthesize a sequence of speech segments, yielding each segment's PCM followed
 * by a chunk of silence sized from its `pauseAfterMs`. This is what gives spoken
 * output its structural pacing (pauses after headings, between list items, etc.).
 */
export async function* synthesizeSegments(
  segments: SpeechSegment[],
  voice: string = DEFAULT_VOICE,
  speed: number = 1,
): AsyncGenerator<Float32Array> {
  for (const seg of segments) {
    if (seg.text && seg.text.trim()) {
      yield* synthesizeStream(seg.text, voice, speed);
    }
    const n = silenceSampleCount(seg.pauseAfterMs, speed);
    if (n > 0) yield new Float32Array(n);
  }
}
