import { describe, expect, it } from 'vitest';
import {
  createHeadingAnchor,
  getSectionByAnchor,
  parseCapabilityMarkdown,
  searchCapabilitySections,
} from './search';
import { createCapabilityCatalog, type CapabilityDocsLoader } from './catalog';

const fixture = `# Product guide

Introductory text about the product.

## Search the web

Use web search to find current sources and cite them.

### Search limits

Search results are bounded.

## Search the web

A second heading has a stable duplicate anchor.

## Local files

Search uploaded files without sending them to the web provider.
`;

const loader = (files: Record<string, string>): CapabilityDocsLoader => ({
  listFiles: () => Object.keys(files),
  readFile: (filename) => {
    const content = files[filename];
    if (content === undefined) throw new Error('missing fixture');
    return content;
  },
});

describe('capability Markdown search', () => {
  it('parses headings and creates stable duplicate anchors', () => {
    expect(createHeadingAnchor('What’s *new*?')).toBe('whats-new');
    const page = parseCapabilityMarkdown(fixture, { slug: 'guide' });

    expect(page.title).toBe('Product guide');
    expect(page.sections.map((section) => section.anchor)).toEqual([
      'product-guide',
      'search-the-web',
      'search-limits',
      'search-the-web-1',
      'local-files',
    ]);
    expect(page.sections[1].content).toContain('Use web search');
    expect(page.sections[1].content).toContain('### Search limits');
    expect(page.sections[2].content).not.toContain('## Search the web');
  });

  it('ignores headings inside fenced code and normalizes punctuation', () => {
    const page = parseCapabilityMarkdown(
      '# A *useful* guide\n\n```md\n## Not a section\n```\n\n## What’s new?\n\nText',
      'guide',
    );

    expect(page.sections.map((section) => section.anchor)).toEqual([
      'a-useful-guide',
      'whats-new',
    ]);
  });

  it('ranks targeted heading matches before body-only matches', () => {
    const page = parseCapabilityMarkdown(fixture, { slug: 'guide' });
    const results = searchCapabilitySections(page.sections, 'web search', {
      maxResults: 5,
    });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].section.anchor).toBe('search-the-web');
    expect(results[0].score).toBeGreaterThan(results[1]?.score ?? 0);
  });

  it('supports broad searches and bounds result/content sizes', () => {
    const page = parseCapabilityMarkdown(fixture, { slug: 'guide' });
    const results = searchCapabilitySections(page.sections, '', {
      maxResults: 2,
      maxContentChars: 30,
    });

    expect(results).toHaveLength(2);
    expect(results.every((result) => result.section.content.length <= 30)).toBe(
      true,
    );
  });

  it('does not interpret path-like queries as filesystem paths', () => {
    const page = parseCapabilityMarkdown(fixture, { slug: 'guide' });
    expect(searchCapabilitySections(page.sections, '../../etc/passwd')).toEqual(
      [],
    );
    expect(getSectionByAnchor(page, '../search-the-web')).toBeNull();
  });
});

describe('capability catalog', () => {
  it('retrieves exact pages and sections only from the catalog', async () => {
    const catalog = createCapabilityCatalog(
      loader({
        'chat-and-research.md': fixture,
        'privacy-and-data.md': '# Other\n\n## Intro\nText',
      }),
    );

    const page = await catalog.getPage('chat-and-research');
    expect(page.ok).toBe(true);
    if (page.ok) expect(page.value.title).toBe('Product guide');

    const section = await catalog.getSection(
      'chat-and-research',
      'search-the-web-1',
    );
    expect(section.ok).toBe(true);
    const invalidPage = await catalog.getPage('../guide');
    const invalidSection = await catalog.getSection(
      'chat-and-research.md',
      'search-the-web',
    );
    expect(invalidPage.ok).toBe(false);
    expect(invalidSection.ok).toBe(false);
    if (!invalidPage.ok) expect(invalidPage.kind).toBe('invalid');
    if (!invalidSection.ok) expect(invalidSection.kind).toBe('invalid');
  });

  it('returns no-match for missing queries and exact sections', async () => {
    const catalog = createCapabilityCatalog(
      loader({ 'chat-and-research.md': fixture }),
    );

    const missingQuery = await catalog.search('does not exist');
    const missingSection = await catalog.getSection(
      'chat-and-research',
      'missing',
    );
    expect(missingQuery.ok).toBe(false);
    expect(missingSection.ok).toBe(false);
    if (!missingQuery.ok) expect(missingQuery.kind).toBe('no_match');
    if (!missingSection.ok) expect(missingSection.kind).toBe('no_match');
  });

  it('rejects oversized input and bounds returned content', async () => {
    const catalog = createCapabilityCatalog(
      loader({ 'chat-and-research.md': fixture }),
    );

    const oversized = await catalog.search('x'.repeat(10000));
    expect(oversized.ok).toBe(false);
    if (!oversized.ok) expect(oversized.kind).toBe('invalid');
    const result = await catalog.search('search', {
      maxResults: 1,
      maxContentChars: 20,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect(result.value[0].section.content.length).toBeLessThanOrEqual(20);
    }
  });

  it('fails closed when the corpus loader fails', async () => {
    const failingLoader: CapabilityDocsLoader = {
      listFiles: () => ['chat-and-research.md'],
      readFile: () => {
        throw new Error('/secret/path/docs/capabilities/chat-and-research.md');
      },
    };
    const catalog = createCapabilityCatalog(failingLoader);

    const result = await catalog.search('product');
    expect(result).toEqual(
      expect.objectContaining({ ok: false, kind: 'unavailable' }),
    );
    expect(JSON.stringify(result)).not.toContain('/secret/path');
  });
});
