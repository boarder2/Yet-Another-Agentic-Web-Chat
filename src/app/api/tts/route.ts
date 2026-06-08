import {
  synthesizeStream,
  SAMPLE_RATE,
  DEFAULT_VOICE,
  VOICE_LIST,
} from '@/lib/tts/kokoro';

export const runtime = 'nodejs';

interface TTSBody {
  text?: string;
  voice?: string;
  speed?: number;
}

// Safety cap to bound synthesis time on pathological input.
const MAX_CHARS = 500_000;

export const GET = () =>
  Response.json({ voices: VOICE_LIST, defaultVoice: DEFAULT_VOICE });

export const POST = async (req: Request) => {
  try {
    const body: TTSBody = await req.json();
    const text = body.text?.trim();

    if (!text) {
      return Response.json(
        { message: 'No text provided to synthesize.' },
        { status: 400 },
      );
    }

    const speed = Math.min(3, Math.max(0.25, body.speed ?? 1));

    // Stream raw 32-bit float PCM (little-endian) sentence by sentence so the
    // client can begin playback on the first chunk while the rest generate.
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const samples of synthesizeStream(
            text.slice(0, MAX_CHARS),
            body.voice || DEFAULT_VOICE,
            speed,
          )) {
            // Copy out of the model's WASM-backed buffer into a plain Buffer.
            const out = Buffer.alloc(samples.length * 4);
            for (let i = 0; i < samples.length; i++) {
              out.writeFloatLE(samples[i], i * 4);
            }
            controller.enqueue(new Uint8Array(out));
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
