// WAV helpers for streaming Kokoro's PCM into an <audio> element. We emit 16-bit
// signed PCM (format 1) rather than the model's native 32-bit float so playback
// works everywhere (Safari is unreliable with IEEE-float WAV).

/**
 * Build a 44-byte canonical PCM WAV header. With `dataSize` omitted, the RIFF and
 * data chunk sizes are set to the 32-bit max so the file reads as open-ended — the
 * body is streamed with chunked transfer and the element keeps reading until the
 * connection closes (works in Chrome/Firefox). Pass `dataSize` (PCM byte length)
 * to write a finite, seekable header — required by Safari, which won't play media
 * without honoring byte-range requests against a known total size.
 */
export const wavHeader = (
  sampleRate: number,
  {
    bitsPerSample = 16,
    channels = 1,
    dataSize,
  }: { bitsPerSample?: number; channels?: number; dataSize?: number } = {},
): Uint8Array => {
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataChunk = dataSize ?? 0xffffffff; // open-ended when unknown
  const riffChunk = dataSize !== undefined ? 36 + dataSize : 0xffffffff;

  const buf = new ArrayBuffer(44);
  const view = new DataView(buf);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++)
      view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, riffChunk, true); // chunk size (36 + data, or open-ended)
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(36, 'data');
  view.setUint32(40, dataChunk, true); // data size (or open-ended)

  return new Uint8Array(buf);
};

/**
 * Reinterpret a chunk of little-endian 32-bit float PCM (Kokoro's output) as
 * little-endian 16-bit signed PCM. `bytes.length` is a multiple of 4 (whole
 * Float32 samples) because the synthesizer yields owned Float32Array buffers.
 */
export const float32ToInt16LE = (bytes: Uint8Array): Uint8Array => {
  const floats = new Float32Array(
    bytes.buffer,
    bytes.byteOffset,
    Math.floor(bytes.byteLength / 4),
  );
  const out = new Int16Array(floats.length);
  for (let i = 0; i < floats.length; i++) {
    const s = Math.max(-1, Math.min(1, floats[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
};
