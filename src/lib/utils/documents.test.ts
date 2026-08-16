import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadCachedRecord: vi.fn(),
  writeCachedRecord: vi.fn(),
  launch: vi.fn(),
}));

vi.mock('@/lib/utils/webCache', () => ({
  loadCachedRecord: mocks.loadCachedRecord,
  writeCachedRecord: mocks.writeCachedRecord,
}));
vi.mock('playwright', () => ({
  chromium: { launch: mocks.launch },
}));

import { retrieveYoutubeTranscript } from './documents';

const videoUrl = 'https://www.youtube.com/watch?v=abcdefghijk';

const track = (baseUrl: string, fields: Record<string, unknown> = {}) => ({
  baseUrl,
  ...fields,
});

const playerResponse = (
  captionTracks: unknown[],
  fields: Record<string, unknown> = {},
) => ({
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks,
      ...fields,
    },
  },
});

type PanelSegment = { ts: string; text: string };

type HarnessOptions = {
  playerResponse: unknown;
  fallbackPlayerResponse?: unknown;
  panelSegments?: PanelSegment[] | null;
  captionPayload?: unknown;
  apiKey?: string | null;
  visitorData?: string | null;
};

const makeHarness = ({
  playerResponse: initialPlayerResponse,
  fallbackPlayerResponse,
  panelSegments = null,
  captionPayload = { events: [] },
  apiKey = 'page-api-key',
  visitorData = 'visitor-token',
}: HarnessOptions) => {
  const fetchMock = vi.fn(async (input: unknown, _init?: unknown) => {
    const requestedUrl = String(input);
    if (requestedUrl.includes('/youtubei/v1/player?key=')) {
      return {
        ok: true,
        status: 200,
        json: async () => fallbackPlayerResponse ?? {},
        text: async () => '',
      };
    }
    if (requestedUrl.startsWith('https://captions.test/')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => JSON.stringify(captionPayload),
      };
    }
    throw new Error(`Unexpected request: ${requestedUrl}`);
  });
  vi.stubGlobal('fetch', fetchMock);

  const page = {
    goto: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(undefined),
    waitForSelector: vi.fn(async () => {
      if (panelSegments === null) throw new Error('panel unavailable');
      return {};
    }),
    $$eval: vi.fn().mockResolvedValue(panelSegments ?? []),
    title: vi.fn().mockResolvedValue('Fixture video - YouTube'),
    evaluate: vi.fn(async (...args: unknown[]) => {
      const pageFunction = args[0];
      if (typeof pageFunction !== 'function') {
        throw new Error('Expected a page evaluation function');
      }
      if (args.length === 1)
        return {
          playerResponse: initialPlayerResponse,
          apiKey,
          visitorData,
        };
      return await pageFunction(args[1]);
    }),
  };
  const context = {
    addCookies: vi.fn().mockResolvedValue(undefined),
    route: vi.fn().mockResolvedValue(undefined),
    newPage: vi.fn().mockResolvedValue(page),
  };
  const browser = {
    newContext: vi.fn().mockResolvedValue(context),
    close: vi.fn().mockResolvedValue(undefined),
  };
  mocks.launch.mockResolvedValue(browser);

  return { browser, context, page, fetchMock };
};

beforeEach(() => {
  mocks.loadCachedRecord.mockReset().mockResolvedValue(null);
  mocks.writeCachedRecord.mockReset().mockResolvedValue(undefined);
  mocks.launch.mockReset();
  vi.unstubAllGlobals();
});

describe('retrieveYoutubeTranscript', () => {
  it('bypasses the panel for Gemini tracks and caches JSON3 fallback text', async () => {
    const fallbackUrl = 'https://captions.test/android-vr';
    const { browser, page, fetchMock } = makeHarness({
      playerResponse: playerResponse([
        track('https://captions.test/watch-page', {
          languageCode: 'en',
          variant: 'gemini',
        }),
      ]),
      fallbackPlayerResponse: playerResponse(
        [
          track('https://captions.test/translated?tlang=fr', {
            languageCode: 'en',
            isTranslated: true,
          }),
          track(fallbackUrl, { languageCode: 'en' }),
        ],
        { defaultCaptionTrackIndex: 1 },
      ),
      captionPayload: {
        events: [
          {
            tStartMs: 0,
            segs: [{ utf8: 'Six months ago we came here to Borla' }],
          },
        ],
      },
    });

    const document = await retrieveYoutubeTranscript(videoUrl);

    expect(document?.pageContent).toBe(
      '[0:00] Six months ago we came here to Borla',
    );
    expect(page.click).not.toHaveBeenCalled();
    expect(page.waitForSelector).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [playerRequestUrl, playerRequestInit] = fetchMock.mock.calls[0];
    expect(playerRequestUrl).toBe(
      'https://www.youtube.com/youtubei/v1/player?key=page-api-key',
    );
    expect(playerRequestInit).toMatchObject({
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-YouTube-Client-Name': '28',
        'X-YouTube-Client-Version': '1.60.19',
      },
    });
    expect(JSON.parse(String((playerRequestInit as RequestInit).body))).toEqual(
      expect.objectContaining({
        videoId: 'abcdefghijk',
        context: {
          client: expect.objectContaining({
            clientName: 'ANDROID_VR',
            visitorData: 'visitor-token',
          }),
        },
      }),
    );
    expect(fetchMock.mock.calls[1][0]).toBe(`${fallbackUrl}?fmt=json3`);
    expect(mocks.writeCachedRecord).toHaveBeenCalledWith(
      `${videoUrl}_youtube`,
      {
        pageContent: '[0:00] Six months ago we came here to Borla',
        title: 'Fixture video',
        metadata: { source: 'abcdefghijk' },
      },
    );
    expect(document?.metadata).toMatchObject({
      title: 'Fixture video',
      url: videoUrl,
      source: 'abcdefghijk',
    });
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it('keeps the panel-first path for conventional tracks', async () => {
    const { page, fetchMock } = makeHarness({
      playerResponse: playerResponse([
        track('https://captions.test/conventional', { languageCode: 'en' }),
      ]),
      panelSegments: [{ ts: '0:04', text: 'Rendered panel transcript' }],
    });

    const document = await retrieveYoutubeTranscript(videoUrl);

    expect(document?.pageContent).toBe('[0:04] Rendered panel transcript');
    expect(page.click).toHaveBeenCalledWith('#expand', { timeout: 3000 });
    expect(page.waitForSelector).toHaveBeenCalledWith(
      'transcript-segment-view-model',
      { timeout: 8000 },
    );
    expect(page.$$eval).toHaveBeenCalledWith(
      'transcript-segment-view-model',
      expect.any(Function),
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to Android VR JSON3 captions when the conventional panel fails', async () => {
    const { page, fetchMock } = makeHarness({
      playerResponse: playerResponse([
        track('https://captions.test/conventional', { languageCode: 'en' }),
      ]),
      fallbackPlayerResponse: playerResponse([
        track('https://captions.test/fallback', { languageCode: 'en' }),
      ]),
      captionPayload: {
        events: [{ tStartMs: 61_000, segs: [{ utf8: 'Fallback transcript' }] }],
      },
    });

    const document = await retrieveYoutubeTranscript(videoUrl);

    expect(document?.pageContent).toBe('[1:01] Fallback transcript');
    expect(page.waitForSelector).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns null only when the loaded player response advertises no tracks', async () => {
    const { browser, page, fetchMock } = makeHarness({
      playerResponse: { videoDetails: { videoId: 'abcdefghijk' } },
    });

    await expect(retrieveYoutubeTranscript(videoUrl)).resolves.toBeNull();

    expect(page.click).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.writeCachedRecord).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it('throws a retrieval error when advertised tracks produce no caption text', async () => {
    const { browser } = makeHarness({
      playerResponse: playerResponse([
        track('https://captions.test/conventional', { languageCode: 'en' }),
      ]),
      fallbackPlayerResponse: playerResponse([]),
    });

    await expect(retrieveYoutubeTranscript(videoUrl)).rejects.toThrow(
      'YouTube advertised captions',
    );

    expect(mocks.writeCachedRecord).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it('does not treat malformed advertised tracks as genuine absence', async () => {
    const { browser, page, fetchMock } = makeHarness({
      playerResponse: playerResponse([{ languageCode: 'en' }]),
    });

    await expect(retrieveYoutubeTranscript(videoUrl)).rejects.toThrow(
      'no usable caption track was available',
    );

    expect(page.click).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it('falls back to the panel when the Android VR player serves a Gemini track no captions', async () => {
    const { page, fetchMock } = makeHarness({
      playerResponse: playerResponse([
        track('https://captions.test/gemini', {
          languageCode: 'en',
          variant: 'gemini',
        }),
      ]),
      fallbackPlayerResponse: playerResponse([]),
      panelSegments: [{ ts: '0:07', text: 'Panel rescued the Gemini track' }],
    });

    const document = await retrieveYoutubeTranscript(videoUrl);

    expect(document?.pageContent).toBe('[0:07] Panel rescued the Gemini track');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(page.waitForSelector).toHaveBeenCalled();
  });

  it('names every attempted source when no source produces text', async () => {
    const { browser, page } = makeHarness({
      playerResponse: playerResponse([
        track('https://captions.test/gemini', {
          languageCode: 'en',
          variant: 'gemini',
        }),
      ]),
      apiKey: null,
    });

    await expect(retrieveYoutubeTranscript(videoUrl)).rejects.toThrow(
      /json3 failed: the InnerTube API key was unavailable; panel failed: the transcript panel did not open/,
    );

    // The panel is tried even when the JSON3 lead fails before any request.
    expect(page.click).toHaveBeenCalled();
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it('closes the browser when cancellation arrives after navigation', async () => {
    const controller = new AbortController();
    const { browser, page } = makeHarness({
      playerResponse: playerResponse([
        track('https://captions.test/conventional', { languageCode: 'en' }),
      ]),
      panelSegments: [{ ts: '0:00', text: 'unused' }],
    });
    page.waitForTimeout.mockImplementation(async () => {
      controller.abort();
    });

    await expect(
      retrieveYoutubeTranscript(videoUrl, controller.signal),
    ).resolves.toBeNull();

    expect(browser.close).toHaveBeenCalledOnce();
    expect(mocks.writeCachedRecord).not.toHaveBeenCalled();
  });
});
