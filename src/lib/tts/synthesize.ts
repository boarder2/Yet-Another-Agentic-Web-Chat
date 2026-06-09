import { synthesizeStream as inlineStream } from './kokoro';
import { isWorkerDisabled, synthesizeViaWorker } from './workerPool';

/** View a (owned) Float32Array's bytes as PCM without an extra per-sample copy. */
const floatToBytes = (samples: Float32Array): Uint8Array =>
  new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);

async function* inlineBytes(
  text: string,
  voice: string,
  speed: number,
): AsyncGenerator<Uint8Array> {
  for await (const samples of inlineStream(text, voice, speed)) {
    yield floatToBytes(samples);
  }
}

/**
 * Synthesize speech, yielding raw 32-bit float PCM bytes (little-endian, 24kHz
 * mono). Prefers the isolated worker process so synthesis can't starve the
 * server; falls back to in-process synthesis if the worker is disabled or fails
 * to start (e.g. environments without `nice`/`taskset`).
 */
export async function* synthesize(
  text: string,
  voice: string,
  speed: number,
): AsyncGenerator<Uint8Array> {
  if (isWorkerDisabled()) {
    yield* inlineBytes(text, voice, speed);
    return;
  }

  let yielded = false;
  try {
    for await (const buf of synthesizeViaWorker(text, voice, speed)) {
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

  yield* inlineBytes(text, voice, speed);
}
