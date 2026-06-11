import { SAMPLE_RATE } from '@/lib/tts/kokoro';
import { synthesize } from '@/lib/tts/synthesize';
import { peek, take } from '@/lib/tts/prepCache';
import { wavHeader, float32ToInt16LE } from '@/lib/tts/wav';
import type { SpeechSegment } from '@/lib/tts/speechify';

export const runtime = 'nodejs';

// WebKit refuses to play media unless the server honors byte-range requests
// against a known total size — it won't accept the open-ended chunked WAV that
// Chrome/Firefox stream happily. This is true of *all* WebKit, not just desktop
// Safari: on iOS every browser (Chrome/CriOS, Firefox/FxiOS, in-app WebViews) is
// WebKit. Route them to a fully-rendered, range-capable WAV instead, at the cost
// of streaming start. Misdetection only degrades gracefully (a Blink/Gecko engine
// sent down the range path still plays; a WebKit engine that slips through falls
// back to browser speech client-side).
const needsRangeWav = (ua: string): boolean => {
  // iOS/iPadOS — every browser there is WebKit.
  if (/iphone|ipad|ipod/i.test(ua)) return true;
  // Desktop Safari (and iPadOS desktop-mode, which reports as "Macintosh"):
  // WebKit identifies as "Version/<n> … Safari" and never as a Blink/Gecko brand.
  return (
    /version\/[\d._]+.*safari/i.test(ua) &&
    !/(chrome|chromium|crios|fxios|edgios|edg|opr|android|firefox)/i.test(ua)
  );
};

/** Render the complete 16-bit PCM WAV (header + all audio) into one Buffer. */
const renderWav = async (
  segs: SpeechSegment[],
  voice: string,
): Promise<Buffer> => {
  const parts: Uint8Array[] = [];
  for await (const bytes of synthesize(segs, voice, 1)) {
    parts.push(float32ToInt16LE(bytes));
  }
  const dataSize = parts.reduce((n, p) => n + p.length, 0);
  const header = wavHeader(SAMPLE_RATE, { bitsPerSample: 16, dataSize });
  return Buffer.concat([header, ...parts]);
};

// Response's BodyInit requires an ArrayBuffer-backed view; a Buffer (or a view
// over ArrayBufferLike) isn't assignable. Copy into a fresh ArrayBuffer-backed
// Uint8Array so the type checks and the body owns its memory.
const body = (b: Uint8Array): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(new ArrayBuffer(b.byteLength));
  out.set(b);
  return out;
};

/** Serve a Buffer with byte-range support (206 for Range requests, else 200). */
const serveRange = (buf: Buffer, range: string | null): Response => {
  const total = buf.length;
  const baseHeaders = {
    'Content-Type': 'audio/wav',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  };

  const m = /bytes=(\d+)-(\d*)/.exec(range ?? '');
  if (!m) {
    return new Response(body(buf), {
      headers: { ...baseHeaders, 'Content-Length': String(total) },
    });
  }

  const start = parseInt(m[1], 10);
  const end = m[2] ? Math.min(parseInt(m[2], 10), total - 1) : total - 1;
  if (start >= total || start > end) {
    return new Response(null, {
      status: 416,
      headers: { ...baseHeaders, 'Content-Range': `bytes */${total}` },
    });
  }
  const chunk = buf.subarray(start, end + 1);
  return new Response(body(chunk), {
    status: 206,
    headers: {
      ...baseHeaders,
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Content-Length': String(chunk.length),
    },
  });
};

/**
 * Stream a 16-bit PCM WAV that an <audio> element plays. The speech segments are
 * prepared by POST /api/tts and claimed here by `id`. Chrome/Firefox get a
 * progressive (streaming-start) response; WebKit gets a fully-rendered, seekable
 * one (see needsRangeWav above).
 *
 * Synthesis always runs at 1× (best model quality); the client controls speed via
 * the media element's playbackRate, so browser speed extensions work too.
 */
export const GET = async (req: Request) => {
  const id = new URL(req.url).searchParams.get('id');
  if (!id) {
    return Response.json({ message: 'Missing id.' }, { status: 400 });
  }

  // WebKit re-fetches the same id (0-1 probe then the full request), so peek and
  // keep the entry; the streaming path consumes its id once, so take it. Both
  // 404 once the entry is gone (expired, or already streamed).
  const webkit = needsRangeWav(req.headers.get('user-agent') ?? '');
  const entry = webkit ? peek(id) : take(id);
  if (!entry) {
    return Response.json(
      { message: 'Speech preparation expired or not found.' },
      { status: 404 },
    );
  }

  const { segments: segs, voice } = entry;
  if (segs.length === 0) {
    return Response.json(
      { message: 'Nothing speakable in the provided content.' },
      { status: 400 },
    );
  }

  // WebKit path: render the whole WAV once (memoized on the prep entry so the
  // 0-1 probe and the follow-up full request share it) and serve byte ranges.
  if (webkit) {
    try {
      entry.wav ??= renderWav(segs, voice);
      const buf = await entry.wav;
      return serveRange(buf, req.headers.get('range'));
    } catch (err) {
      // Drop the memoized rejection so a retry within the TTL can re-synthesize.
      entry.wav = undefined;
      console.error('Error synthesizing speech:', err);
      return Response.json(
        { message: 'An error occurred while synthesizing speech.' },
        { status: 500 },
      );
    }
  }

  // Chrome/Firefox path: progressive open-ended WAV, played as it streams.
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(wavHeader(SAMPLE_RATE, { bitsPerSample: 16 }));
        for await (const bytes of synthesize(segs, voice, 1)) {
          // Stop synthesizing if the client went away (stop / replay). Throwing
          // breaks the for-await, which cancels the underlying worker job.
          if (req.signal.aborted) break;
          controller.enqueue(float32ToInt16LE(bytes));
        }
        controller.close();
      } catch (err) {
        if (req.signal.aborted) return;
        console.error('Error synthesizing speech:', err);
        controller.error(err);
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'audio/wav',
      'Cache-Control': 'no-store',
    },
  });
};
