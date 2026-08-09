import {
  loadCachedRecord,
  purgeWebCache,
  writeCachedRecord,
} from '@/lib/utils/webCache';
import { extractText } from '@/lib/workspaces/extractAdapter';
import { Document } from '@langchain/core/documents';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { chromium, Page, Browser, BrowserContext } from 'playwright';
import TurndownService from 'turndown';
import {
  isGeminiCaptionTrack,
  parseJson3Captions,
  readCaptionTrackList,
  selectCaptionTrack,
  type YouTubeCaptionTrack,
} from '@/lib/utils/youtubeCaptions';

function htmlToMarkdown(html: string): string {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
  });

  // Remove inline SVGs (noisy markup, not useful content)
  turndown.addRule('removeSvg', {
    filter: (node) => node.nodeName.toLowerCase() === 'svg',
    replacement: () => '',
  });

  // Convert video/audio/iframe to links so the URLs are preserved as context
  turndown.addRule('mediaToLink', {
    filter: ['video', 'audio', 'iframe'],
    replacement: (_content, node) => {
      const el = node as HTMLElement;
      const src =
        el.getAttribute('src') ||
        el.querySelector('source')?.getAttribute('src') ||
        '';
      if (!src || src.startsWith('data:')) return '';
      const tag = el.nodeName.toLowerCase();
      const title =
        el.getAttribute('title') || el.getAttribute('alt') || `${tag} content`;
      return `[${title}](${src})`;
    },
  });

  // Flatten block-level elements (headings, divs, paragraphs) inside links
  // so we get clean `[Title](url)` instead of `[\n\n### Title\n\n](url)`
  turndown.addRule('flattenLinksWithBlocks', {
    filter: (node) => {
      if (node.nodeName.toLowerCase() !== 'a') return false;
      const href = node.getAttribute('href');
      if (!href) return false;
      // Only apply when the link contains block-level children
      return !!node.querySelector('h1, h2, h3, h4, h5, h6, p, div, section');
    },
    replacement: (_content, node) => {
      const el = node as HTMLElement;
      const href = el.getAttribute('href') || '';
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) return '';
      return `[${text}](${href})`;
    },
  });

  return turndown.turndown(html);
}

export const retrievePdfDoc = async (url: string): Promise<Document | null> => {
  try {
    // Read pdf into a Blob and pass to WebPDFLoader
    console.log('[retrievePdfDoc] Retrieving PDF content for URL:', url);
    const cached = await loadCachedRecord(url + '_pdf');
    if (cached) {
      console.log(
        '[retrievePdfDoc] Typed content found in cache for URL:',
        url,
      );
      return new Document({
        pageContent: cached.pageContent || '',
        metadata: {
          title: cached.title || '',
          url: cached.url,
          ...cached.metadata,
        },
      });
    }
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const pdfBuffer = Buffer.from(await res.arrayBuffer());
    const pageContent = (await extractText(pdfBuffer, 'application/pdf')) ?? '';
    if (pageContent) {
      const doc = new Document({
        pageContent,
        metadata: { url, title: 'PDF Document' },
      });
      await writeCachedRecord(url + '_pdf', doc);
      return doc;
    }
  } catch (error) {
    console.error('[retrievePdfDoc] Error retrieving PDF content:', error);
  }
  return null;
};

/** Extract the 11-char video ID from a watch/youtu.be/shorts/embed URL. */
const extractYoutubeVideoId = (url: string): string | null => {
  const m = url.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/,
  );
  return m ? m[1] : null;
};

const ANDROID_VR_CLIENT = {
  clientName: 'ANDROID_VR',
  clientVersion: '1.60.19',
  deviceMake: 'Oculus',
  deviceModel: 'Quest 3',
  androidSdkVersion: 32,
  userAgent:
    'com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12; en_US; Quest 3 Build/SQ3A.220705.003)',
  osName: 'Android',
  osVersion: '12',
  hl: 'en',
  gl: 'US',
} as const;
const ANDROID_VR_CLIENT_ID = '28';

type YoutubePageData = {
  playerResponse: unknown;
  apiKey: string | null;
  visitorData: string | null;
};

const readYoutubePageData = async (page: Page): Promise<YoutubePageData> =>
  page.evaluate(() => {
    type YoutubeGlobals = typeof globalThis & {
      ytInitialPlayerResponse?: unknown;
      ytcfg?: { get?: (key: string) => unknown };
    };

    const globals = globalThis as YoutubeGlobals;
    const playerResponse = globals.ytInitialPlayerResponse;
    let apiKey: unknown;
    let visitorData: unknown;
    let context: unknown;
    if (typeof globals.ytcfg?.get === 'function') {
      try {
        apiKey = globals.ytcfg.get('INNERTUBE_API_KEY');
      } catch {}
      try {
        visitorData = globals.ytcfg.get('VISITOR_DATA');
      } catch {}
      try {
        context = globals.ytcfg.get('INNERTUBE_CONTEXT');
      } catch {}
    }

    const playerRecord =
      playerResponse !== null &&
      typeof playerResponse === 'object' &&
      !Array.isArray(playerResponse)
        ? (playerResponse as Record<string, unknown>)
        : null;
    const contextRecord =
      context !== null && typeof context === 'object' && !Array.isArray(context)
        ? (context as Record<string, unknown>)
        : null;
    const contextClient =
      contextRecord?.client !== null &&
      typeof contextRecord?.client === 'object' &&
      !Array.isArray(contextRecord.client)
        ? (contextRecord.client as Record<string, unknown>)
        : null;
    const responseContext =
      playerRecord?.responseContext !== null &&
      typeof playerRecord?.responseContext === 'object' &&
      !Array.isArray(playerRecord.responseContext)
        ? (playerRecord.responseContext as Record<string, unknown>)
        : null;
    visitorData =
      visitorData ?? contextClient?.visitorData ?? responseContext?.visitorData;

    return {
      playerResponse: playerResponse ?? null,
      apiKey: typeof apiKey === 'string' && apiKey ? apiKey : null,
      visitorData:
        typeof visitorData === 'string' && visitorData ? visitorData : null,
    };
  });

const retrieveAndroidVrPlayerResponse = async (
  page: Page,
  videoId: string,
  apiKey: string,
  visitorData: string | null,
): Promise<unknown> =>
  page.evaluate(
    async ({ videoId, apiKey, visitorData, client, clientId }) => {
      const response = await fetch(
        `https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-YouTube-Client-Name': clientId,
            'X-YouTube-Client-Version': client.clientVersion,
          },
          body: JSON.stringify({
            context: {
              client: {
                ...client,
                ...(visitorData ? { visitorData } : {}),
              },
            },
            videoId,
          }),
        },
      );
      if (!response.ok) {
        throw new Error(
          `Android VR player request failed with HTTP ${response.status}`,
        );
      }
      return (await response.json()) as unknown;
    },
    {
      videoId,
      apiKey,
      visitorData,
      client: ANDROID_VR_CLIENT,
      clientId: ANDROID_VR_CLIENT_ID,
    },
  );

const retrieveJson3Captions = async (
  page: Page,
  track: YouTubeCaptionTrack,
): Promise<string | null> => {
  const payload = await page.evaluate(async (baseUrl) => {
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      throw new Error('YouTube caption track URL was invalid');
    }
    url.searchParams.set('fmt', 'json3');

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(
        `YouTube caption request failed with HTTP ${response.status}`,
      );
    }
    return await response.text();
  }, track.baseUrl);

  return parseJson3Captions(payload);
};

const readPanelTranscript = async (page: Page): Promise<string | null> => {
  try {
    // Expand the description (the transcript button lives inside it), then open
    // the transcript panel. Both clicks are best-effort across layout variants.
    try {
      await page.click('#expand', { timeout: 3000 });
    } catch {}
    for (const sel of [
      'button[aria-label="Show transcript"]',
      'ytd-video-description-transcript-section-renderer button',
    ]) {
      try {
        await page.click(sel, { timeout: 3000 });
        break;
      } catch {}
    }

    const hasPanel = await page
      .waitForSelector('transcript-segment-view-model', { timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    if (!hasPanel) return null;

    const segments = await page.$$eval('transcript-segment-view-model', (els) =>
      els
        .map((el) => ({
          ts:
            el
              .querySelector('.ytwTranscriptSegmentViewModelTimestamp')
              ?.textContent?.trim() || '',
          text:
            el
              .querySelector('[role="text"]')
              ?.textContent?.replace(/\s+/g, ' ')
              .trim() || '',
        }))
        .filter((s) => s.text),
    );
    if (segments.length === 0) return null;

    return segments
      .map((s) => (s.ts ? `[${s.ts}] ${s.text}` : s.text))
      .join('\n');
  } catch (error) {
    console.warn('[retrieveYoutubeTranscript] Transcript panel failed:', error);
    return null;
  }
};

const saveYoutubeTranscript = async (
  page: Page,
  url: string,
  pageContent: string,
): Promise<Document> => {
  const title = (await page.title()).replace(/ - YouTube$/, '').trim();
  // `source` holds the bare video ID — the ToolCall UI embeds it as a player.
  const source = extractYoutubeVideoId(url) ?? url;

  await writeCachedRecord(url + '_youtube', {
    pageContent,
    title,
    metadata: { source },
  });

  return new Document({
    pageContent,
    metadata: {
      title: title || 'YouTube Video Transcript',
      url,
      source,
    },
  });
};

/**
 * Retrieves a YouTube video's transcript by driving a real browser.
 *
 * YouTube's watch-page player response advertises the available caption tracks.
 * Conventional tracks still use the rendered transcript panel first. Gemini
 * tracks bypass that panel and use the browser's native Android VR InnerTube
 * client to fetch signed JSON3 captions; that path is also the fallback when
 * the panel cannot produce text. Returns null only when no caption tracks are
 * advertised. Advertised tracks that cannot produce text throw a retrieval
 * error so callers can distinguish absence from failure.
 */
export const retrieveYoutubeTranscript = async (
  url: string,
  signal?: AbortSignal,
): Promise<Document | null> => {
  const cached = await loadCachedRecord(url + '_youtube');
  if (cached) {
    console.log('[retrieveYoutubeTranscript] Cache hit for URL:', url);
    return new Document({
      pageContent: cached.pageContent || '',
      metadata: {
        title: cached.title || '',
        url: cached.url,
        ...cached.metadata,
      },
    });
  }

  if (signal?.aborted) return null;
  console.log(
    '[retrieveYoutubeTranscript] Retrieving transcript for URL:',
    url,
  );

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({
      headless: true,
      chromiumSandbox: true,
      handleSIGHUP: false,
      handleSIGINT: false,
      handleSIGTERM: false,
    });
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36',
      locale: 'en-US',
    });
    // Pre-accept the consent interstitial so we land straight on the watch page.
    await context.addCookies([
      { name: 'CONSENT', value: 'YES+', domain: '.youtube.com', path: '/' },
    ]);
    // The transcript panel needs no video/media/fonts/images — skip them.
    await context.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (type === 'media' || type === 'font' || type === 'image') {
        return route.abort();
      }
      return route.continue();
    });

    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    if (signal?.aborted) return null;

    const pageData = await readYoutubePageData(page);
    if (
      !pageData.playerResponse ||
      typeof pageData.playerResponse !== 'object' ||
      Array.isArray(pageData.playerResponse)
    ) {
      throw new Error('YouTube player response was not available');
    }

    const trackList = readCaptionTrackList(pageData.playerResponse);
    const rawCaptionTracks = (
      pageData.playerResponse as {
        captions?: {
          playerCaptionsTracklistRenderer?: { captionTracks?: unknown };
        };
      }
    ).captions?.playerCaptionsTracklistRenderer?.captionTracks;
    const hasAdvertisedCaptionTracks =
      Array.isArray(rawCaptionTracks) && rawCaptionTracks.length > 0;

    if (!hasAdvertisedCaptionTracks) {
      console.log('[retrieveYoutubeTranscript] No transcript available:', url);
      return null;
    }
    if (!trackList || trackList.captionTracks.length === 0) {
      throw new Error(
        'YouTube advertised captions, but no usable caption track was available',
      );
    }

    const selectedTrack = selectCaptionTrack(trackList);
    if (!selectedTrack) {
      throw new Error(
        'YouTube advertised captions, but no original caption track was available',
      );
    }

    let pageContent: string | null = null;
    if (!isGeminiCaptionTrack(selectedTrack)) {
      pageContent = await readPanelTranscript(page);
      if (signal?.aborted) return null;
    }

    if (!pageContent) {
      const videoId = extractYoutubeVideoId(url);
      if (!videoId) {
        throw new Error(
          'YouTube advertised captions, but the video ID could not be determined',
        );
      }
      if (!pageData.apiKey) {
        throw new Error(
          'YouTube advertised captions, but the InnerTube API key was unavailable',
        );
      }
      if (signal?.aborted) return null;

      const fallbackPlayerResponse = await retrieveAndroidVrPlayerResponse(
        page,
        videoId,
        pageData.apiKey,
        pageData.visitorData,
      );
      if (signal?.aborted) return null;

      const fallbackTrack = selectCaptionTrack(fallbackPlayerResponse);
      if (!fallbackTrack) {
        throw new Error(
          'YouTube advertised captions, but the Android VR player returned no original caption track',
        );
      }

      pageContent = await retrieveJson3Captions(page, fallbackTrack);
      if (signal?.aborted) return null;
      if (!pageContent) {
        throw new Error(
          'YouTube advertised captions, but no caption text could be retrieved',
        );
      }
    }

    return await saveYoutubeTranscript(page, url, pageContent);
  } catch (error) {
    if (signal?.aborted) return null;
    console.error('[retrieveYoutubeTranscript] Error:', error);
    throw error instanceof Error
      ? error
      : new Error('YouTube transcript retrieval failed');
  } finally {
    try {
      if (browser) await browser.close();
    } catch (closeError) {
      console.error(
        '[retrieveYoutubeTranscript] Error closing browser:',
        closeError,
      );
    }
  }
};

export const retrieveTypedContentFunc = async (
  url: string,
): Promise<Document | null> => {
  if (url.includes('youtube.com/watch') || url.includes('youtu.be/')) {
    return await retrieveYoutubeTranscript(url);
  } else if (url.endsWith('.pdf')) {
    return await retrievePdfDoc(url);
  }
  return null;
};

/**
 * Fetches web content from a given URL using Playwright.
 * Sanitizes the DOM, parses with Readability, then converts to markdown via Turndown.
 * Returns a Document with clean markdown (including inline links) as pageContent.
 *
 * @param url - The URL to fetch content from.
 * @param truncateToLength - Maximum length of the returned text content.
 * @param signal - Optional AbortSignal to cancel the operation.
 * @param performAggressiveValidation - If true, performs additional validation on the fetched content. Like ensuring the parsed article has a title and sufficient length.
 * @param retrieveTypedContent - If true, attempts to retrieve typed content (e.g., youtube transcripts) when applicable.
 * @returns A Promise that resolves to a Document object or null if parsing fails.
 */
export const getWebContent = async (
  url: string,
  truncateToLength: number = 30000,
  signal?: AbortSignal,
  performAggressiveValidation: boolean = false,
  retrieveTypedContent: boolean = false,
): Promise<Document | null> => {
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  try {
    if (signal?.aborted) {
      console.warn(`getWebContent aborted before start for URL: ${url}`);
      return null;
    }
    // Opportunistic purge then try cache
    await purgeWebCache();

    // Cache hit path (in-memory or disk)
    const cached = await loadCachedRecord(url);
    if (cached) {
      const docFromCache = new Document({
        pageContent: cached.pageContent || '',
        metadata: {
          title: cached.title || '',
          url: cached.url,
        },
      });
      return docFromCache;
    }

    console.log(`Fetching content from URL: ${url}`);

    // Attempt to retrieve typed content first if enabled
    if (retrieveTypedContent) {
      const typedDoc = await retrieveTypedContentFunc(url);
      if (typedDoc) {
        return typedDoc;
      }
    }

    browser = await chromium.launch({
      headless: true,
      chromiumSandbox: true,
      // Disable Playwright's global signal handlers — in a long-running server,
      // they conflict with concurrent browser instances and the app's own process
      // management, causing child processes to not be reaped (zombie processes).
      // We manage browser lifecycle ourselves via the finally block below.
      // This is sus, but we're gonna give it a try.
      handleSIGHUP: false,
      handleSIGINT: false,
      handleSIGTERM: false,
    });

    context = await browser.newContext();
    page = await context.newPage();

    // Set a timeout for navigation and content loading
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });

    try {
      // Wait an additional 3 seconds for no more network traffic
      await page.waitForLoadState('networkidle', { timeout: 3000 });
    } catch (_e) {
      // Ignore timeout errors from waitForLoadState. This is just a best-effort wait.
      // We'll still attempt to get the content even if network isn't fully idle.
      console.warn(`Timeout waiting for networkidle on URL: ${url}`);
    }

    // Best-effort: Playwright loader doesn't expose signal; emulate via early return hooks
    if (signal?.aborted) return null;

    // Sanitize the live DOM before extracting HTML — remove non-content
    // elements and noisy attributes to produce cleaner Readability output
    await page.evaluate(() => {
      const removeSelectors = [
        'script',
        'style',
        'noscript',
        'svg',
        'link[rel="stylesheet"]',
        'nav',
        'header',
        'footer',
        'iframe',
        'video',
        'audio',
        'picture',
        '[role="navigation"]',
        '[role="banner"]',
        '[role="contentinfo"]',
        '[aria-hidden="true"]',
      ];
      for (const sel of removeSelectors) {
        document.querySelectorAll(sel).forEach((el) => el.remove());
      }

      const noisyAttrs =
        /^(js|data-|aria-|class|style|id|onclick|onload|srcset|loading|tabindex|role|ve-|jslog|jsname|jsdata|jsaction|jscontroller|jsrenderer|jsmodel|jsshadow)/i;
      document.querySelectorAll('*').forEach((el) => {
        for (const attr of [...el.attributes]) {
          if (noisyAttrs.test(attr.name)) {
            el.removeAttribute(attr.name);
          }
        }
      });

      // Resolve relative URLs to absolute so links and images are usable outside the page
      document.querySelectorAll('a[href]').forEach((a) => {
        (a as HTMLAnchorElement).setAttribute(
          'href',
          (a as HTMLAnchorElement).href,
        );
      });
      document.querySelectorAll('img[src]').forEach((img) => {
        (img as HTMLImageElement).setAttribute(
          'src',
          (img as HTMLImageElement).src,
        );
      });
      document
        .querySelectorAll('video[src], audio[src], source[src]')
        .forEach((el) => {
          const src = el.getAttribute('src');
          if (src) {
            try {
              el.setAttribute('src', new URL(src, document.baseURI).href);
            } catch {}
          }
        });
    });

    const html = await page.content();

    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    if (
      performAggressiveValidation &&
      (!article ||
        !article.title ||
        !article.textContent ||
        article.textContent.length < 200 ||
        article.title.length < 5)
    ) {
      throw new Error(
        'Readability parsing failed or returned insufficient content for Playwright-loaded page on url: ' +
          url,
      );
    }

    // Convert Readability's article HTML to clean markdown with inline links.
    // When Readability returns too little content (common on homepages/SPAs),
    // fall back to converting the sanitized <body> directly to preserve links.
    const articleTextLength = article?.textContent?.length || 0;
    let markdown: string;

    if (articleTextLength < 2000) {
      console.log(
        `Readability returned insufficient content (${articleTextLength} chars), falling back to direct body conversion for URL: ${url}`,
      );
      const bodyHtml = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] || html;
      markdown = htmlToMarkdown(bodyHtml);
    } else {
      markdown = htmlToMarkdown(article?.content || '');
    }

    // Write to cache
    await writeCachedRecord(url, {
      pageContent: markdown,
      title: article?.title || (await page.title()) || '',
    });

    const returnDoc = new Document({
      pageContent:
        markdown.length > truncateToLength
          ? markdown.slice(0, truncateToLength)
          : markdown,
      metadata: {
        title: article?.title || (await page.title()) || '',
        url: url,
      },
    });

    console.log(
      `Got content with Playwright, URL: ${url}, Text Length: ${returnDoc.pageContent.length}, Truncated: ${markdown.length > truncateToLength}`,
    );

    return returnDoc;
  } catch (error) {
    console.error(`Error fetching/parsing URL ${url}:`, error);

    // Fallback to a plain fetch for simpler content extraction
    try {
      console.log(`Fallback to direct fetch for URL: ${url}`);
      if (signal?.aborted) return null;
      const res = await fetch(url, {
        signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; YAAWC/1.0)' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rawHtml = await res.text();

      if (rawHtml) {
        // Apply Readability to extract meaningful content from the fetched HTML
        const dom = new JSDOM(rawHtml, { url });

        // Resolve relative URLs to absolute in the fetched DOM
        dom.window.document
          .querySelectorAll('a[href]')
          .forEach((a: Element) => {
            const href = a.getAttribute('href');
            if (href) {
              try {
                a.setAttribute('href', new URL(href, url).href);
              } catch {}
            }
          });
        dom.window.document
          .querySelectorAll('img[src], video[src], audio[src], source[src]')
          .forEach((el: Element) => {
            const src = el.getAttribute('src');
            if (src) {
              try {
                el.setAttribute('src', new URL(src, url).href);
              } catch {}
            }
          });

        const reader = new Readability(dom.window.document);
        const article = reader.parse();
        if (
          performAggressiveValidation &&
          (!article ||
            !article.title ||
            !article.textContent ||
            article.textContent.length < 200 ||
            article.title.length < 5)
        ) {
          console.log(
            `Direct-fetch fallback also failed Readability validation for URL: ${url}`,
          );
          return null;
        }

        // Convert Readability's article HTML to clean markdown with inline links.
        // When Readability returns too little content (common on homepages/SPAs),
        // fall back to converting the raw HTML body directly to preserve links.
        const fallbackArticleTextLength = article?.textContent?.length || 0;
        let markdown: string;

        if (fallbackArticleTextLength < 2000) {
          console.log(
            `Readability returned insufficient content (${fallbackArticleTextLength} chars) in fallback path, falling back to direct body conversion for URL: ${url}`,
          );
          const bodyHtml =
            rawHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] || rawHtml;
          markdown = htmlToMarkdown(bodyHtml);
        } else {
          markdown = htmlToMarkdown(article?.content || '');
        }

        // Write to cache
        await writeCachedRecord(url, {
          pageContent: markdown,
          title: article?.title || '',
        });

        const returnDoc = new Document({
          pageContent:
            markdown.length > truncateToLength
              ? markdown.slice(0, truncateToLength)
              : markdown,
          metadata: {
            title: article?.title || '',
            url: url,
          },
        });

        console.log(
          `Got content with direct fetch fallback + Readability, URL: ${url}, Text Length: ${returnDoc.pageContent.length} Truncated: ${markdown.length > truncateToLength}`,
        );

        return returnDoc;
      }
    } catch (fallbackError) {
      console.error(
        `Direct-fetch fallback also failed for URL ${url}:`,
        fallbackError,
      );
    }

    return null;
  } finally {
    // Ensure browser is closed to prevent resource leaks
    try {
      if (page) await page.close();
      if (context) await context.close();
      if (browser) await browser.close();
    } catch (closeError) {
      console.error('Error closing Playwright resources:', closeError);
    }
  }
};
