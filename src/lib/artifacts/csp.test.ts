import { describe, it, expect } from 'vitest';
import {
  ARTIFACT_CSP_HEADER,
  ARTIFACT_CSP_META,
  injectCspMeta,
  artifactFilename,
} from './csp';

describe('ARTIFACT_CSP_HEADER', () => {
  it('blocks everything by default and never grants connect-src', () => {
    expect(ARTIFACT_CSP_HEADER).toContain("default-src 'none'");
    expect(ARTIFACT_CSP_HEADER).not.toContain('connect-src');
  });

  it('allows only inline script and style, with no host sources', () => {
    expect(ARTIFACT_CSP_HEADER).toContain("script-src 'unsafe-inline'");
    expect(ARTIFACT_CSP_HEADER).toContain("style-src 'unsafe-inline'");
    expect(ARTIFACT_CSP_HEADER).not.toMatch(/https?:/);
  });

  it('restricts images, fonts and media to inert schemes', () => {
    expect(ARTIFACT_CSP_HEADER).toContain('img-src data: blob:');
    expect(ARTIFACT_CSP_HEADER).toContain('font-src data:');
    expect(ARTIFACT_CSP_HEADER).toContain('media-src data: blob:');
  });

  it('pins the framing, form and base-uri restrictions', () => {
    expect(ARTIFACT_CSP_HEADER).toContain("frame-ancestors 'self'");
    expect(ARTIFACT_CSP_HEADER).toContain("form-action 'none'");
    expect(ARTIFACT_CSP_HEADER).toContain("base-uri 'none'");
  });

  it('strands the document on an opaque origin regardless of how it loads', () => {
    // The raw route is reachable top-level and via a popup, where the viewer's
    // iframe sandbox attribute does not apply; only the header travels along.
    expect(ARTIFACT_CSP_HEADER).toContain('sandbox ');
    expect(ARTIFACT_CSP_HEADER).not.toContain('allow-same-origin');
  });

  it('lets an artifact script and open links, and nothing else', () => {
    const sandbox = ARTIFACT_CSP_HEADER.split('; ').find((d) =>
      d.startsWith('sandbox'),
    );
    expect(sandbox?.split(' ').slice(1).sort()).toEqual([
      'allow-popups',
      'allow-scripts',
    ]);
  });
});

describe('ARTIFACT_CSP_META', () => {
  it('drops the header-only directives, which are ignored in a meta tag', () => {
    expect(ARTIFACT_CSP_META).not.toContain('frame-ancestors');
    expect(ARTIFACT_CSP_META).not.toContain('sandbox');
  });

  it('keeps every other directive from the header policy', () => {
    for (const directive of ARTIFACT_CSP_HEADER.split(';').map((d) =>
      d.trim(),
    )) {
      if (/^(frame-ancestors|sandbox)\b/.test(directive)) continue;
      expect(ARTIFACT_CSP_META).toContain(directive);
    }
  });
});

describe('injectCspMeta', () => {
  it('inserts the meta tag immediately after an existing <head>', () => {
    const html =
      '<!doctype html><html><head><title>T</title></head><body>x</body></html>';
    const out = injectCspMeta(html);
    expect(out).toContain('<meta http-equiv="Content-Security-Policy"');
    expect(out.indexOf('<meta http-equiv')).toBeLessThan(
      out.indexOf('<title>'),
    );
    expect(out).toContain('<body>x</body>');
  });

  it('matches <head> case-insensitively and with attributes', () => {
    const out = injectCspMeta(
      '<HTML><HEAD lang="en"><title>T</title></HEAD></HTML>',
    );
    expect(out).toContain('<meta http-equiv="Content-Security-Policy"');
    expect(out.indexOf('<meta http-equiv')).toBeLessThan(
      out.indexOf('<title>'),
    );
  });

  it('synthesizes a head after <html> when the document has none', () => {
    const out = injectCspMeta('<!doctype html><html><body>hi</body></html>');
    expect(out).toContain('<head><meta http-equiv="Content-Security-Policy"');
    expect(out).toContain('</head>');
    expect(out.indexOf('<head>')).toBeLessThan(out.indexOf('<body>'));
  });

  it('prepends the head to a bare fragment with no html element', () => {
    const out = injectCspMeta('<h1>hi</h1>');
    expect(out).toContain('<meta http-equiv="Content-Security-Policy"');
    expect(out.indexOf('<meta http-equiv')).toBeLessThan(out.indexOf('<h1>'));
  });

  it('escapes the policy so it cannot break out of the attribute', () => {
    expect(injectCspMeta('<html><head></head></html>')).not.toContain(
      'content=""',
    );
    expect(ARTIFACT_CSP_META).not.toContain('"');
  });

  it('injects ahead of a permissive policy the agent wrote itself', () => {
    // The agent authors these bytes, so its own CSP meta must never suppress
    // ours. Browsers intersect multiple policies to the most restrictive.
    const hostile =
      '<html><head><meta http-equiv="Content-Security-Policy" content="default-src *"></head><body>x</body></html>';
    const out = injectCspMeta(hostile);
    expect(out).toContain(ARTIFACT_CSP_META);
    expect(out.indexOf(ARTIFACT_CSP_META)).toBeLessThan(
      out.indexOf('default-src *'),
    );
  });
});

describe('artifactFilename', () => {
  it('slugifies the title and appends the version', () => {
    expect(artifactFilename('Q3 Revenue Report!', 4)).toBe(
      'q3-revenue-report-v4.html',
    );
  });

  it('falls back to a generic name for a title with no usable characters', () => {
    expect(artifactFilename('!!!', 1)).toBe('artifact-v1.html');
  });

  it('strips characters that would break the Content-Disposition header', () => {
    const name = artifactFilename('a"b\\c\r\nd/e', 2);
    expect(name).not.toMatch(/["\\\r\n/]/);
  });

  it('caps the slug length', () => {
    expect(artifactFilename('x'.repeat(300), 1).length).toBeLessThanOrEqual(80);
  });
});
