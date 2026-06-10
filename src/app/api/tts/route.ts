import {
  SAMPLE_RATE,
  DEFAULT_VOICE,
  VOICE_LIST,
  isValidVoice,
} from '@/lib/tts/kokoro';
import { synthesize } from '@/lib/tts/synthesize';
import { speechify, type SpeechSegment } from '@/lib/tts/speechify';
import { getOrGenerateNarration } from '@/lib/tts/narration';
import type { ModelRef } from '@/lib/providers/resolveModels';

export const runtime = 'nodejs';

type Mode = 'read' | 'narrate';

interface TTSBody {
  // `markdown` is the rich message content (preferred); `text` is the legacy
  // plain-text shape (voice previews). Either is run through speechify().
  markdown?: string;
  text?: string;
  mode?: Mode;
  messageId?: string;
  voice?: string;
  speed?: number;
  narrationModel?: ModelRef;
}

// Safety cap to bound synthesis time on pathological input.
const MAX_CHARS = 500_000;

export const GET = () =>
  Response.json({ voices: VOICE_LIST, defaultVoice: DEFAULT_VOICE });

export const POST = async (req: Request) => {
  try {
    const body: TTSBody = await req.json();
    const source = (body.markdown ?? body.text ?? '').slice(0, MAX_CHARS);

    if (!source.trim()) {
      return Response.json(
        { message: 'No text provided to synthesize.' },
        { status: 400 },
      );
    }

    const speed = Math.min(3, Math.max(0.25, body.speed ?? 1));
    const voice = isValidVoice(body.voice ?? '') ? body.voice! : DEFAULT_VOICE;

    // Mode 2: rewrite to an LLM narration first (cached in DB). Falls back to the
    // raw source on any failure so read-aloud never hard-errors.
    let spoken = source;
    if (body.mode === 'narrate' && body.markdown && body.messageId) {
      try {
        const narration = await getOrGenerateNarration({
          messageId: body.messageId,
          content: body.markdown,
          model: body.narrationModel,
        });
        if (narration) spoken = narration;
      } catch (err) {
        console.warn('[tts] narration failed, falling back to read mode:', err);
      }
    }

    const segments: SpeechSegment[] = speechify(spoken);
    if (segments.length === 0) {
      return Response.json(
        { message: 'Nothing speakable in the provided content.' },
        { status: 400 },
      );
    }

    // Stream raw 32-bit float PCM (little-endian) segment by segment so the
    // client can begin playback on the first chunk while the rest generate.
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const bytes of synthesize(segments, voice, speed)) {
            controller.enqueue(bytes);
          }
          controller.close();
        } catch (err) {
          console.error('Error synthesizing speech:', err);
          controller.error(err);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Sample-Rate': String(SAMPLE_RATE),
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('Error synthesizing speech:', err);
    return Response.json(
      { message: 'An error occurred while synthesizing speech.' },
      { status: 500 },
    );
  }
};
