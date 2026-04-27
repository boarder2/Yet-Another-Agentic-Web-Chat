import {
  loadCachedRecord,
  purgeWebCache,
  writeCachedRecord,
} from '@/lib/utils/webCache';
import { CheerioWebBaseLoader } from '@langchain/community/document_loaders/web/cheerio';
import { YoutubeLoader } from '@langchain/community/document_loaders/web/youtube';
import { Document } from '@langchain/core/documents';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { chromium, Page, Browser, BrowserContext } from 'playwright';
import { WebPDFLoader } from '@langchain/community/document_loaders/web/pdf';
import TurndownService from 'turndown';
import { getSearchLocale } from '@/lib/config';

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
    const pdfBuffer = await res.arrayBuffer();
    const pdfBlob = new Blob([pdfBuffer], { type: 'application/pdf' });
    const pdfLoader = new WebPDFLoader(pdfBlob, { splitPages: false });
    const docs = await pdfLoader.load();
    console.log('[retrievePdfDoc] PDF content retrieved successfully:', docs);
    if (docs.length > 0) {
      docs[0].metadata.url = url;
      docs[0].metadata.title = docs[0].metadata.title || 'PDF Document';
      // Write to cache
      await writeCachedRecord(url + '_pdf', docs[0]);
      return docs[0];
    }
  } catch (error) {
    console.error('[retrievePdfDoc] Error retrieving PDF content:', error);
  }
  return null;
};

export const retrieveYoutubeTranscript = async (
  url: string,
): Promise<Document | null> => {
  try {
    console.log(
      '[retrieveYoutubeTranscript] Retrieving YouTube transcript for URL:',
      url,
    );
    const cached = await loadCachedRecord(url + '_youtube');
    if (cached) {
      console.log(
        '[retrieveYoutubeTranscript] Typed content found in cache for URL:',
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

    const transcriptLoader = YoutubeLoader.createFromUrl(url, {
      language: getSearchLocale().language,
      addVideoInfo: true,
    });
    const transcript = await transcriptLoader.load();
    console.log(
      '[retrieveYoutubeTranscript] YouTube transcript retrieved successfully:',
      transcript,
    );
    if (transcript.length > 0) {
      transcript[0].metadata.url = url;
      transcript[0].metadata.title =
        transcript[0].metadata.title || 'YouTube Video Transcript';
      transcript[0].metadata.source =
        transcript[0].metadata.source || undefined;
      // Write to cache
      await writeCachedRecord(url + '_youtube', transcript[0]);
      return transcript[0];
    }
  } catch (error) {
    console.error('Error retrieving YouTube transcript:', error);
  }
  return null;
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

    // Fallback to CheerioWebBaseLoader for simpler content extraction
    try {
      console.log(`Fallback to Cheerio for URL: ${url}`);
      const cheerioLoader = new CheerioWebBaseLoader(url, { maxRetries: 2 });
      if (signal?.aborted) return null;
      const docs = await cheerioLoader.load();

      if (docs && docs.length > 0) {
        const doc = docs[0];

        // Apply Readability to extract meaningful content from Cheerio HTML
        const dom = new JSDOM(doc.pageContent, { url });

        // Resolve relative URLs to absolute in the Cheerio-loaded DOM
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
            `Cheerio fallback also failed Readability validation for URL: ${url}`,
          );
          return null;
        }

        // Convert Readability's article HTML to clean markdown with inline links.
        // When Readability returns too little content (common on homepages/SPAs),
        // fall back to converting the raw HTML body directly to preserve links.
        const cheerioArticleTextLength = article?.textContent?.length || 0;
        let markdown: string;

        if (cheerioArticleTextLength < 2000) {
          console.log(
            `Readability returned insufficient content (${cheerioArticleTextLength} chars) in Cheerio path, falling back to direct body conversion for URL: ${url}`,
          );
          const bodyHtml =
            doc.pageContent.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ||
            doc.pageContent;
          markdown = htmlToMarkdown(bodyHtml);
        } else {
          markdown = htmlToMarkdown(article?.content || '');
        }

        // Write to cache
        await writeCachedRecord(url, {
          pageContent: markdown,
          title: article?.title || doc.metadata.title || '',
        });

        const returnDoc = new Document({
          pageContent:
            markdown.length > truncateToLength
              ? markdown.slice(0, truncateToLength)
              : markdown,
          metadata: {
            title: article?.title || doc.metadata.title || '',
            url: url,
          },
        });

        console.log(
          `Got content with Cheerio fallback + Readability, URL: ${url}, Text Length: ${returnDoc.pageContent.length} Truncated: ${markdown.length > truncateToLength}`,
        );

        return returnDoc;
      }
    } catch (fallbackError) {
      console.error(
        `Cheerio fallback also failed for URL ${url}:`,
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
