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
type InnerTubeClientKey = 'androidVr' | 'android' | 'ios';

type HarnessOptions = {
  playerResponse: unknown;
  fallbackPlayerResponse?: unknown;
  innerTubePlayerResponses?: Partial<Record<InnerTubeClientKey, unknown>>;
  playerRequestErrors?: Partial<Record<InnerTubeClientKey, string>>;
  playerRequestStatuses?: Partial<Record<InnerTubeClientKey, number>>;
  panelSegments?: PanelSegment[] | null;
  captionPayload?: unknown;
  captionPayloads?: Record<string, unknown>;
  beforePlayerRequest?: (client: InnerTubeClientKey) => void;
  apiKey?: string | null;
  visitorData?: string | null;
};

const makeHarness = ({
  playerResponse: initialPlayerResponse,
  fallbackPlayerResponse,
  innerTubePlayerResponses,
  playerRequestErrors,
  playerRequestStatuses,
  panelSegments = null,
  captionPayload = { events: [] },
  captionPayloads,
  beforePlayerRequest,
  apiKey = 'page-api-key',
  visitorData = 'visitor-token',
}: HarnessOptions) => {
  const playerResponses: Record<InnerTubeClientKey, unknown> = {
    androidVr: fallbackPlayerResponse ?? {},
    android: {},
    ios: {},
    ...innerTubePlayerResponses,
  };
  const playerRequests: Array<{
    client: InnerTubeClientKey;
    init: RequestInit;
  }> = [];
  const clientNames: Record<string, InnerTubeClientKey> = {
    ANDROID_VR: 'androidVr',
    ANDROID: 'android',
    IOS: 'ios',
  };

  const fetchMock = vi.fn(async (input: unknown, init?: unknown) => {
    const requestedUrl = String(input);
    if (requestedUrl.includes('/youtubei/v1/player?key=')) {
      const requestInit = (init ?? {}) as RequestInit;
      const requestBody = JSON.parse(String(requestInit.body));
      const clientName = requestBody.context?.client?.clientName;
      const client = clientNames[clientName];
      if (!client)
        throw new Error(`Unexpected InnerTube client: ${clientName}`);
      playerRequests.push({ client, init: requestInit });
      beforePlayerRequest?.(client);

      const requestError = playerRequestErrors?.[client];
      if (requestError) throw new Error(requestError);
      const status = playerRequestStatuses?.[client] ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => playerResponses[client],
        text: async () => '',
      };
    }
    if (requestedUrl.startsWith('https://captions.test/')) {
      const baseUrl = requestedUrl.split('?')[0];
      const payload =
        captionPayloads &&
        Object.prototype.hasOwnProperty.call(captionPayloads, baseUrl)
          ? captionPayloads[baseUrl]
          : captionPayload;
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => JSON.stringify(payload),
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

  return { browser, context, page, fetchMock, playerRequests };
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
    const { browser, page, fetchMock, playerRequests } = makeHarness({
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
    expect(playerRequests.map(({ client }) => client)).toEqual(['androidVr']);
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
    const { page, fetchMock, playerRequests } = makeHarness({
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
    expect(playerRequests).toEqual([]);
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

  it('uses Android after panel and Android VR return no transcript text', async () => {
    const androidVrUrl = 'https://captions.test/android-vr-empty';
    const androidUrl = 'https://captions.test/android-rescue';
    const { page, fetchMock, playerRequests } = makeHarness({
      playerResponse: playerResponse([
        track('https://captions.test/watch-page', { languageCode: 'en' }),
      ]),
      fallbackPlayerResponse: playerResponse([
        track(androidVrUrl, { languageCode: 'en' }),
      ]),
      innerTubePlayerResponses: {
        android: playerResponse([track(androidUrl, { languageCode: 'en' })]),
      },
      captionPayloads: {
        [androidVrUrl]: { events: [] },
        [androidUrl]: {
          events: [
            {
              tStartMs: 12_000,
              segs: [{ utf8: 'Android rescued the transcript' }],
            },
          ],
        },
      },
    });

    const document = await retrieveYoutubeTranscript(videoUrl);

    expect(document?.pageContent).toBe('[0:12] Android rescued the transcript');
    expect(page.waitForSelector).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(playerRequests.map(({ client }) => client)).toEqual([
      'androidVr',
      'android',
    ]);

    const androidRequest = playerRequests[1];
    expect(androidRequest.init).toMatchObject({
      method: 'POST',
      headers: {
        'X-YouTube-Client-Name': '3',
        'X-YouTube-Client-Version': '21.26.364',
      },
    });
    expect(JSON.parse(String(androidRequest.init.body))).toEqual(
      expect.objectContaining({
        videoId: 'abcdefghijk',
        context: {
          client: expect.objectContaining({
            clientName: 'ANDROID',
            clientVersion: '21.26.364',
            visitorData: 'visitor-token',
          }),
        },
      }),
    );
  });

  it('keeps Android as the next source for Gemini after Android VR and panel fail', async () => {
    const androidUrl = 'https://captions.test/android-gemini-rescue';
    const { page, playerRequests } = makeHarness({
      playerResponse: playerResponse([
        track('https://captions.test/gemini', {
          languageCode: 'en',
          variant: 'gemini',
        }),
      ]),
      fallbackPlayerResponse: {
        playabilityStatus: {
          status: 'LOGIN_REQUIRED',
          reason: 'Android VR is unavailable',
        },
      },
      innerTubePlayerResponses: {
        android: playerResponse([track(androidUrl, { languageCode: 'en' })]),
      },
      captionPayloads: {
        [androidUrl]: {
          events: [
            {
              tStartMs: 24_000,
              segs: [{ utf8: 'Android rescued Gemini captions' }],
            },
          ],
        },
      },
    });

    const document = await retrieveYoutubeTranscript(videoUrl);

    expect(document?.pageContent).toBe(
      '[0:24] Android rescued Gemini captions',
    );
    expect(page.click).toHaveBeenCalledWith('#expand', { timeout: 3000 });
    expect(playerRequests.map(({ client }) => client)).toEqual([
      'androidVr',
      'android',
    ]);
  });

  it('uses iOS after Android VR is gated and Android returns an HTTP error', async () => {
    const iosUrl = 'https://captions.test/ios-rescue';
    const { fetchMock, playerRequests } = makeHarness({
      playerResponse: playerResponse([
        track('https://captions.test/watch-page', { languageCode: 'en' }),
      ]),
      fallbackPlayerResponse: {
        playabilityStatus: {
          status: 'LOGIN_REQUIRED',
          reason: 'Android VR is unavailable',
        },
      },
      innerTubePlayerResponses: {
        android: playerResponse([]),
        ios: playerResponse([track(iosUrl, { languageCode: 'en' })]),
      },
      playerRequestStatuses: { android: 403 },
      captionPayloads: {
        [iosUrl]: {
          events: [
            {
              tStartMs: 36_000,
              segs: [{ utf8: 'iOS rescued the transcript' }],
            },
          ],
        },
      },
    });

    const document = await retrieveYoutubeTranscript(videoUrl);

    expect(document?.pageContent).toBe('[0:36] iOS rescued the transcript');
    expect(playerRequests.map(({ client }) => client)).toEqual([
      'androidVr',
      'android',
      'ios',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const iosRequest = playerRequests[2];
    expect(iosRequest.init).toMatchObject({
      method: 'POST',
      headers: {
        'X-YouTube-Client-Name': '5',
        'X-YouTube-Client-Version': '21.26.4',
      },
    });
    expect(JSON.parse(String(iosRequest.init.body))).toEqual(
      expect.objectContaining({
        videoId: 'abcdefghijk',
        context: {
          client: expect.objectContaining({
            clientName: 'IOS',
            clientVersion: '21.26.4',
            visitorData: 'visitor-token',
          }),
        },
      }),
    );
  });

  it('advances past a malformed Android response to the iOS client', async () => {
    const iosUrl = 'https://captions.test/ios-after-malformed';
    const { fetchMock, playerRequests } = makeHarness({
      playerResponse: playerResponse([
        track('https://captions.test/watch-page', { languageCode: 'en' }),
      ]),
      fallbackPlayerResponse: playerResponse([]),
      innerTubePlayerResponses: {
        android: playerResponse([{ languageCode: 'en' }]),
        ios: playerResponse([track(iosUrl, { languageCode: 'en' })]),
      },
      captionPayloads: {
        [iosUrl]: {
          events: [
            {
              tStartMs: 42_000,
              segs: [{ utf8: 'iOS survived a malformed Android response' }],
            },
          ],
        },
      },
    });

    const document = await retrieveYoutubeTranscript(videoUrl);

    expect(document?.pageContent).toBe(
      '[0:42] iOS survived a malformed Android response',
    );
    expect(playerRequests.map(({ client }) => client)).toEqual([
      'androidVr',
      'android',
      'ios',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('advances from a gated Android response to iOS instead of treating captions as absent', async () => {
    const iosUrl = 'https://captions.test/ios-after-android-gate';
    const { fetchMock, playerRequests } = makeHarness({
      playerResponse: playerResponse([
        track('https://captions.test/watch-page', { languageCode: 'en' }),
      ]),
      fallbackPlayerResponse: playerResponse([]),
      innerTubePlayerResponses: {
        android: {
          playabilityStatus: {
            status: 'LOGIN_REQUIRED',
            reason: 'Android requires attestation',
          },
        },
        ios: playerResponse([track(iosUrl, { languageCode: 'en' })]),
      },
      captionPayloads: {
        [iosUrl]: {
          events: [
            {
              tStartMs: 45_000,
              segs: [{ utf8: 'iOS survived the Android gate' }],
            },
          ],
        },
      },
    });

    const document = await retrieveYoutubeTranscript(videoUrl);

    expect(document?.pageContent).toBe('[0:45] iOS survived the Android gate');
    expect(playerRequests.map(({ client }) => client)).toEqual([
      'androidVr',
      'android',
      'ios',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('preserves original-track selection for each mobile player response', async () => {
    const translatedUrl = 'https://captions.test/mobile-translated?tlang=fr';
    const originalUrl = 'https://captions.test/mobile-original';
    const { fetchMock, playerRequests } = makeHarness({
      playerResponse: playerResponse([
        track('https://captions.test/watch-page', { languageCode: 'en' }),
      ]),
      fallbackPlayerResponse: playerResponse([]),
      innerTubePlayerResponses: {
        android: playerResponse(
          [
            track(translatedUrl, {
              languageCode: 'en',
              isTranslated: true,
            }),
            track(originalUrl, { languageCode: 'de' }),
          ],
          { defaultCaptionTrackIndex: 0 },
        ),
      },
      captionPayloads: {
        [originalUrl]: {
          events: [
            {
              tStartMs: 48_000,
              segs: [{ utf8: 'The original mobile track was selected' }],
            },
          ],
        },
      },
    });

    const document = await retrieveYoutubeTranscript(videoUrl);

    expect(document?.pageContent).toBe(
      '[0:48] The original mobile track was selected',
    );
    expect(playerRequests.map(({ client }) => client)).toEqual([
      'androidVr',
      'android',
    ]);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
      'https://www.youtube.com/youtubei/v1/player?key=page-api-key',
      'https://www.youtube.com/youtubei/v1/player?key=page-api-key',
      `${originalUrl}?fmt=json3`,
    ]);
    expect(fetchMock.mock.calls.map(([input]) => String(input))).not.toContain(
      `${translatedUrl}&fmt=json3`,
    );
  });

  it('reports every attempted source without exposing request secrets', async () => {
    const apiKey = 'page-api-key-secret';
    const visitorData = 'visitor-data-secret';
    const signature = 'signature-secret';
    const captionUrl =
      'https://secret.test/captions?signature=signature-secret&sparams=private';
    const failure = `request failed apiKey=${apiKey} visitorData=${visitorData} signature=${signature} url=${captionUrl}`;
    const { browser, fetchMock, playerRequests } = makeHarness({
      playerResponse: playerResponse([
        track('https://captions.test/watch-page', { languageCode: 'en' }),
      ]),
      playerRequestErrors: {
        androidVr: failure,
        android: failure,
        ios: failure,
      },
    });

    const caught = await retrieveYoutubeTranscript(videoUrl).catch(
      (error: unknown) => error,
    );

    expect(caught).toBeInstanceOf(Error);
    const message = caught instanceof Error ? caught.message : String(caught);
    expect(message).toMatch(
      /panel failed:[\s\S]*json3 failed:[\s\S]*android failed:[\s\S]*ios failed:/,
    );
    for (const secret of [apiKey, visitorData, signature, captionUrl]) {
      expect(message).not.toContain(secret);
    }
    expect(playerRequests.map(({ client }) => client)).toEqual([
      'androidVr',
      'android',
      'ios',
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it('does not treat translated-only advertised tracks as original captions', async () => {
    const { browser, page, fetchMock, playerRequests } = makeHarness({
      playerResponse: playerResponse([
        track('https://captions.test/translated?tlang=fr', {
          languageCode: 'fr',
          isTranslated: true,
        }),
      ]),
    });

    await expect(retrieveYoutubeTranscript(videoUrl)).rejects.toThrow(
      'no original caption track was available',
    );

    expect(page.click).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(playerRequests).toEqual([]);
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it('returns null and skips later clients when cancellation occurs during InnerTube retrieval', async () => {
    const controller = new AbortController();
    const androidVrUrl = 'https://captions.test/android-vr-cancelled';
    const { browser, fetchMock, playerRequests } = makeHarness({
      playerResponse: playerResponse([
        track('https://captions.test/conventional', { languageCode: 'en' }),
      ]),
      fallbackPlayerResponse: playerResponse([
        track(androidVrUrl, { languageCode: 'en' }),
      ]),
      captionPayload: {
        events: [
          {
            tStartMs: 0,
            segs: [{ utf8: 'ignored after cancellation' }],
          },
        ],
      },
      beforePlayerRequest: (client) => {
        if (client === 'androidVr') controller.abort();
      },
    });

    await expect(
      retrieveYoutubeTranscript(videoUrl, controller.signal),
    ).resolves.toBeNull();

    expect(playerRequests.map(({ client }) => client)).toEqual(['androidVr']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(browser.close).toHaveBeenCalledOnce();
    expect(mocks.writeCachedRecord).not.toHaveBeenCalled();
  });

  it('returns null and skips later clients when cancellation occurs in the first source', async () => {
    const controller = new AbortController();
    const { browser, page, fetchMock, playerRequests } = makeHarness({
      playerResponse: playerResponse([
        track('https://captions.test/conventional', { languageCode: 'en' }),
      ]),
    });
    page.waitForSelector.mockImplementation(async () => {
      controller.abort();
      throw new Error('panel unavailable');
    });

    await expect(
      retrieveYoutubeTranscript(videoUrl, controller.signal),
    ).resolves.toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(playerRequests).toEqual([]);
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it('returns a cached transcript without launching a browser', async () => {
    mocks.loadCachedRecord.mockResolvedValue({
      pageContent: '[0:01] Cached transcript',
      title: 'Cached video',
      url: videoUrl,
      metadata: { source: 'abcdefghijk' },
    });

    const document = await retrieveYoutubeTranscript(videoUrl);

    expect(document?.pageContent).toBe('[0:01] Cached transcript');
    expect(document?.metadata).toMatchObject({
      title: 'Cached video',
      url: videoUrl,
      source: 'abcdefghijk',
    });
    expect(mocks.launch).not.toHaveBeenCalled();
    expect(mocks.writeCachedRecord).not.toHaveBeenCalled();
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
      /json3 failed: the InnerTube API key was unavailable; panel failed: the transcript panel did not open; android failed: the InnerTube API key was unavailable; ios failed: the InnerTube API key was unavailable/,
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
