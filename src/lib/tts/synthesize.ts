import type { SpeechSegment } from './speechify';
import { synthesizeSegments as inlineSegments } from './kokoro';
import { isWorkerDisabled, synthesizeViaWorker } from './workerPool';

/** View a (owned) Float32Array's bytes as PCM without an extra per-sample copy. */
const floatToBytes = (samples: Float32Array): Uint8Array =>
  new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);

async function* inlineBytes(
  segments: SpeechSegment[],
  voice: string,
  speed: number,
): AsyncGenerator<Uint8Array> {
  for await (const samples of inlineSegments(segments, voice, speed)) {
    yield floatToBytes(samples);
  }
}

/**
 * Synthesize speech segments, yielding raw 32-bit float PCM bytes (little-endian,
 * 24kHz mono) with speed-scaled silence spliced between segments. Prefers the
 * isolated worker process so synthesis can't starve the server; falls back to
 * in-process synthesis if the worker is disabled or fails to start (e.g.
 * environments without `nice`/`taskset`).
 */
export async function* synthesize(
  segments: SpeechSegment[],
  voice: string,
  speed: number,
): AsyncGenerator<Uint8Array> {
  if (isWorkerDisabled()) {
    yield* inlineBytes(segments, voice, speed);
    return;
  }

  let yielded = false;
  try {
    for await (const buf of synthesizeViaWorker(segments, voice, speed)) {
      yielded = true;
      yield buf;
    }
    return;
  } catch (err) {
    // A mid-stream failure can't be retried without duplicating audio; only fall
    // back when the worker failed before producing anything.
    if (yielded) throw err;
    console.warn(
      '[tts] worker unavailable, falling back to inline synthesis:',
      err,
    );
  }

  yield* inlineBytes(segments, voice, speed);
}
