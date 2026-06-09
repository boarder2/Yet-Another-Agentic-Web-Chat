// Long-lived child process that runs Kokoro TTS *off* the main server process.
//
// Spawned by src/lib/tts/workerPool.ts — on Linux it is wrapped in `nice` (lower
// scheduling priority) and `taskset` (pinned to a subset of cores), so ONNX
// Runtime's CPU threadpool can never starve the Next.js event loop that serves
// HTTP. Communication is over the Node IPC channel with advanced serialization,
// which transfers the PCM Buffers across processes without manual framing.
//
// Deliberately plain CommonJS (not TypeScript) so it can be forked directly in
// both `next dev` and the standalone production build with no separate compile
// step. It only depends on `kokoro-js` (loaded via dynamic import, as ESM) and
// Node built-ins.
'use strict';

// Kokoro-82M ONNX model. Mirrors src/lib/tts/kokoro.ts — kept in sync manually
// because this file is plain JS and cannot import the TS module.
const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const DTYPE = process.env.TTS_DTYPE || 'q4';

let ttsPromise;
const getTTS = async () => {
  const { KokoroTTS } = await import('kokoro-js');
  return (ttsPromise ??= KokoroTTS.from_pretrained(MODEL_ID, {
    dtype: DTYPE,
    device: 'cpu',
  }));
};

const send = (msg) => {
  if (process.send) process.send(msg);
};

// Jobs the parent asked us to abandon (consumer hit "stop"). Checked between
// sentences so we stop burning CPU as soon as the client goes away.
const cancelled = new Set();

async function handleJob(job) {
  const { id, text, voice, speed } = job;
  try {
    const tts = await getTTS();
    const { TextSplitterStream } = await import('kokoro-js');
    const splitter = new TextSplitterStream();
    splitter.push(text);
    splitter.close();

    for await (const chunk of tts.stream(splitter, { voice, speed })) {
      if (cancelled.has(id)) break;

      // The yielded RawAudio is backed by WASM tensors whose buffers can detach
      // after the next forward pass; copy into an owned Float32Array first.
      const raw = chunk.audio;
      let src = null;
      try {
        src = raw.data;
      } catch {
        /* buffer detached */
      }
      if (!src || src.length === 0) {
        src = Array.isArray(raw.audio) ? raw.audio[0] : raw.audio;
      }
      if (!src || src.length === 0) continue; // skip empty chunk, don't hang

      const owned = new Float32Array(src);
      const buf = Buffer.from(owned.buffer, owned.byteOffset, owned.byteLength);
      send({ type: 'chunk', id, data: buf });
    }
    send({ type: 'done', id });
  } catch (err) {
    send({ type: 'error', id, message: String((err && err.message) || err) });
  } finally {
    cancelled.delete(id);
  }
}

// Serialize jobs within the worker so two syntheses never run concurrently —
// this is what bounds total CPU regardless of how many requests arrive at once.
let queue = Promise.resolve();

process.on('message', (msg) => {
  if (!msg) return;
  if (msg.type === 'job') {
    queue = queue.then(() => handleJob(msg));
  } else if (msg.type === 'cancel') {
    cancelled.add(msg.id);
  }
});

// Parent closed the IPC channel — exit cleanly.
process.on('disconnect', () => process.exit(0));

// Tell the parent the channel is live and we're ready for jobs.
send({ type: 'ready' });
