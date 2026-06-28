import { DEFAULT_VOICE, VOICE_LIST, isValidVoice } from '@/lib/tts/kokoro';
import { speechify, type SpeechSegment } from '@/lib/tts/speechify';
import { getOrGenerateNarration } from '@/lib/tts/narration';
import { put } from '@/lib/tts/prepCache';
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
  narrationModel?: ModelRef;
}

// Safety cap to bound synthesis time on pathological input.
const MAX_CHARS = 500_000;

export const GET = () =>
  Response.json({ voices: VOICE_LIST, defaultVoice: DEFAULT_VOICE });

/**
 * Prepare step: resolve the spoken text (optionally an LLM narration), split it
 * into speech segments, stash them, and return an id. The audio itself is streamed
 * by GET /api/tts/stream?id=... into an <audio> element, so playback speed is left
 * to the browser (native playbackRate / extensions) and synthesis runs at 1×.
 */
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

    const id = put(segments, voice);
    return Response.json({ id });
  } catch (err) {
    console.error('Error preparing speech:', err);
    return Response.json(
      { message: 'An error occurred while preparing speech.' },
      { status: 500 },
    );
  }
};
