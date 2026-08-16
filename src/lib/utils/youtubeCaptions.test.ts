import { describe, expect, it } from 'vitest';
import {
  describeCaptionAvailability,
  formatCaptionTimestamp,
  isGeminiCaptionTrack,
  parseJson3Captions,
  readCaptionTrackList,
  selectCaptionTrack,
} from './youtubeCaptions';

const track = (id: string, fields: Record<string, unknown> = {}) => ({
  baseUrl: `https://captions.test/${id}`,
  ...fields,
});

const playerResponse = (renderer: Record<string, unknown>) => ({
  captions: { playerCaptionsTracklistRenderer: renderer },
});

describe('readCaptionTrackList', () => {
  it('reads JSON defensively and discards malformed track entries', () => {
    const value = JSON.stringify(
      playerResponse({
        captionTracks: [
          track('english', {
            languageCode: 'en',
            name: { simpleText: 'English' },
          }),
          { baseUrl: '' },
          { languageCode: 'fr' },
          null,
        ],
        audioTracks: [
          { captionTrackIndices: ['0'], defaultCaptionTrackIndex: '0' },
          null,
          {},
        ],
        defaultCaptionTrackIndex: '0',
      }),
    );

    expect(readCaptionTrackList(value)).toEqual({
      captionTracks: [
        track('english', {
          languageCode: 'en',
          name: { simpleText: 'English' },
        }),
      ],
      audioTracks: [{ captionTrackIndices: [0], defaultCaptionTrackIndex: 0 }],
      defaultCaptionTrackIndex: 0,
    });
    expect(readCaptionTrackList({ captions: {} })).toBeNull();
    expect(
      readCaptionTrackList({
        captions: { playerCaptionsTracklistRenderer: { captionTracks: [] } },
      }),
    ).toEqual({ captionTracks: [], audioTracks: [] });
  });
});

describe('selectCaptionTrack', () => {
  it('prefers the declared default over English and ignores a translated default', () => {
    const english = track('english', { languageCode: 'en' });
    const declared = track('declared', { languageCode: 'de' });
    const translated = track('translated', {
      languageCode: 'en',
      isTranslated: true,
    });

    expect(
      selectCaptionTrack(
        playerResponse({
          captionTracks: [english, declared],
          defaultCaptionTrackIndex: 1,
        }),
      ),
    ).toEqual(declared);
    expect(
      selectCaptionTrack(
        playerResponse({
          captionTracks: [english, translated],
          defaultCaptionTrackIndex: 1,
        }),
      ),
    ).toEqual(english);
  });

  it('remaps default indices after malformed caption and audio entries are discarded', () => {
    const value = playerResponse({
      captionTracks: [
        { baseUrl: '' },
        track('first-original', { languageCode: 'es' }),
        track('declared', { languageCode: 'fr' }),
      ],
      audioTracks: [
        {},
        {
          captionTrackIndices: [2],
          defaultCaptionTrackIndex: 2,
          hasDefaultTrack: true,
        },
      ],
      defaultAudioTrackIndex: 1,
    });

    expect(readCaptionTrackList(value)).toEqual({
      captionTracks: [
        track('first-original', { languageCode: 'es' }),
        track('declared', { languageCode: 'fr' }),
      ],
      audioTracks: [
        {
          captionTrackIndices: [1],
          defaultCaptionTrackIndex: 1,
          hasDefaultTrack: true,
        },
      ],
      defaultAudioTrackIndex: 0,
    });
    expect(selectCaptionTrack(value)).toEqual(
      track('declared', { languageCode: 'fr' }),
    );
  });

  it('uses an explicitly flagged original track when no index is declared', () => {
    const english = track('english', { languageCode: 'en' });
    const declared = track('declared', {
      languageCode: 'ja',
      isDefault: true,
    });

    expect(
      selectCaptionTrack(
        playerResponse({ captionTracks: [english, declared] }),
      ),
    ).toEqual(declared);
  });

  it('falls back to English before the first original track', () => {
    const translated = track('translated', {
      languageCode: 'fr',
      baseUrl: 'https://captions.test/translated?lang=fr&tlang=en',
    });
    const english = track('english', { languageCode: 'en-US' });
    const other = track('other', { languageCode: 'de' });

    expect(
      selectCaptionTrack(
        playerResponse({ captionTracks: [translated, english, other] }),
      ),
    ).toEqual(english);
  });

  it('uses the first original track when English is unavailable', () => {
    const translated = track('translated', {
      languageCode: 'en',
      isTranslated: true,
    });
    const firstOriginal = track('first-original', { languageCode: 'es' });
    const secondOriginal = track('second-original', { languageCode: 'fr' });

    expect(
      selectCaptionTrack(
        playerResponse({
          captionTracks: [translated, firstOriginal, secondOriginal],
        }),
      ),
    ).toEqual(firstOriginal);
  });

  it('does not select a translated-only track', () => {
    expect(
      selectCaptionTrack(
        playerResponse({
          captionTracks: [
            track('translated', {
              languageCode: 'en',
              tlang: 'es',
            }),
          ],
        }),
      ),
    ).toBeNull();
  });
});

describe('isGeminiCaptionTrack', () => {
  it('recognizes Gemini variants and leaves conventional tracks alone', () => {
    expect(isGeminiCaptionTrack({ variant: 'gemini' })).toBe(true);
    expect(
      isGeminiCaptionTrack(
        track('gemini-url', {
          baseUrl: 'https://captions.test/gemini?variant=gemini',
        }),
      ),
    ).toBe(true);
    expect(
      isGeminiCaptionTrack(
        track('conventional', { languageCode: 'en', kind: 'asr' }),
      ),
    ).toBe(false);
    expect(
      isGeminiCaptionTrack(
        track('not-gemini', {
          baseUrl: 'https://captions.test/captions?variant=geminiish',
        }),
      ),
    ).toBe(false);
    expect(isGeminiCaptionTrack(null)).toBe(false);
  });
});

describe('describeCaptionAvailability', () => {
  it('describes each usable track and counts the ones it discarded', () => {
    const availability = describeCaptionAvailability(
      playerResponse({
        captionTracks: [
          track('gemini', {
            languageCode: 'en',
            kind: 'asr',
            variant: 'gemini',
          }),
          track('french', { languageCode: 'fr', isTranslated: true }),
          { languageCode: 'de' },
        ],
      }),
    );

    expect(availability).toEqual({
      advertisedTrackCount: 3,
      usableTrackCount: 2,
      tracks: ['en/asr/gemini', 'fr/standard/translated'],
    });
  });

  it('separates a gated response from a video with no captions', () => {
    expect(
      describeCaptionAvailability({
        playabilityStatus: {
          status: 'LOGIN_REQUIRED',
          reason: 'Sign in to confirm you are not a bot',
        },
      }),
    ).toEqual({
      playabilityStatus: 'LOGIN_REQUIRED',
      playabilityReason: 'Sign in to confirm you are not a bot',
      advertisedTrackCount: 0,
      usableTrackCount: 0,
      tracks: [],
    });

    expect(
      describeCaptionAvailability({ playabilityStatus: { status: 'OK' } }),
    ).toEqual({
      playabilityStatus: 'OK',
      advertisedTrackCount: 0,
      usableTrackCount: 0,
      tracks: [],
    });
  });
});

describe('parseJson3Captions', () => {
  it('formats JSON3 events as timestamped lines from an object or JSON string', () => {
    const payload = {
      events: [
        {
          tStartMs: 0,
          segs: [
            { utf8: 'Six months ago we came ' },
            { utf8: 'here to Borla' },
          ],
        },
        { tStartMs: '61500', segs: [{ utf8: ' This is a PlayStation 5. ' }] },
      ],
    };
    const expected =
      '[0:00] Six months ago we came here to Borla\n[1:01] This is a PlayStation 5.';

    expect(parseJson3Captions(payload)).toBe(expected);
    expect(parseJson3Captions(JSON.stringify(payload))).toBe(expected);
  });

  it('ignores empty and control events, returning null when no caption text remains', () => {
    expect(
      parseJson3Captions({
        events: [
          { tStartMs: 0, aAppend: 'control event' },
          { tStartMs: 100, segs: [] },
          { tStartMs: 200, segs: [{ utf8: '   ' }, { utf8: null }] },
          { tStartMs: -1, segs: [{ utf8: 'negative timestamp' }] },
          { tStartMs: 'invalid', segs: [{ utf8: 'invalid timestamp' }] },
        ],
      }),
    ).toBeNull();

    expect(
      parseJson3Captions({
        events: [
          { tStartMs: 250, segs: [{ utf8: '  kept\n text  ' }, { utf8: 42 }] },
          { tStartMs: 300, aAppend: 'another control event' },
        ],
      }),
    ).toBe('[0:00] kept text');
  });

  it('returns null for malformed or empty JSON3 payloads', () => {
    for (const value of [
      null,
      undefined,
      '',
      '{not json',
      {},
      { events: null },
      { events: {} },
      { events: [] },
      JSON.stringify({ events: {} }),
    ]) {
      expect(parseJson3Captions(value)).toBeNull();
    }
  });
});

describe('formatCaptionTimestamp', () => {
  it('keeps hour-scale timestamps in hours, minutes, and seconds', () => {
    expect(formatCaptionTimestamp(0)).toBe('0:00');
    expect(formatCaptionTimestamp(61_999)).toBe('1:01');
    expect(formatCaptionTimestamp(3_723_456)).toBe('1:02:03');
    expect(formatCaptionTimestamp(Number.NaN)).toBe('0:00');
  });
});
