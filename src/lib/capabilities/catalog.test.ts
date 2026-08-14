import { describe, expect, it } from 'vitest';
import {
  createCapabilityCatalog,
  filesystemCapabilityDocsLoader,
  type CapabilityDocsLoader,
} from './catalog';
import { CAPABILITY_DOC_FILENAMES, capabilityPageUrl } from './types';

const fixedFixtureFiles = Object.fromEntries(
  CAPABILITY_DOC_FILENAMES.map((filename) => [
    filename,
    `# ${filename}\n\n## Overview\nThis is the ${filename} capability page.`,
  ]),
);

const loader = (files: Record<string, string>): CapabilityDocsLoader => ({
  listFiles: () => Object.keys(files),
  readFile: (filename) => {
    const content = files[filename];
    if (content === undefined) throw new Error('missing fixture');
    return content;
  },
});

describe('capability docs catalog', () => {
  it('accepts only the fixed corpus filenames, not injected extra files', async () => {
    const files = {
      ...fixedFixtureFiles,
      'not-catalogued.md': '# Secret\n\nThis page must not be exposed.',
      '../outside.md': '# Outside',
    };
    const catalog = createCapabilityCatalog(loader(files));

    const pages = await catalog.listPages();

    expect(pages.map((page) => page.filename)).toEqual([
      ...CAPABILITY_DOC_FILENAMES,
    ]);
    await expect(catalog.getPage('not-catalogued')).resolves.toMatchObject({
      ok: false,
      kind: 'no_match',
    });
    await expect(catalog.search('secret')).resolves.toMatchObject({
      ok: false,
      kind: 'no_match',
    });
  });

  it('rejects path traversal at the filesystem adapter boundary', async () => {
    await expect(
      filesystemCapabilityDocsLoader.readFile('../README.md'),
    ).rejects.toThrow();
    await expect(
      filesystemCapabilityDocsLoader.readFile('README.md/../../package.json'),
    ).rejects.toThrow();
    await expect(
      filesystemCapabilityDocsLoader.readFile('not-catalogued.md'),
    ).rejects.toThrow();
  });

  it('lists the complete shipped corpus in deterministic order', async () => {
    await expect(filesystemCapabilityDocsLoader.listFiles()).resolves.toEqual(
      CAPABILITY_DOC_FILENAMES,
    );
  });

  it('includes the Markdown corpus in standalone output tracing', async () => {
    const config = (await import('../../../next.config.mjs')).default as {
      outputFileTracingIncludes?: Record<string, string[]>;
    };

    expect(config.outputFileTracingIncludes?.['**']).toContain(
      './docs/capabilities/**/*.md',
    );
  });

  it('returns stable in-app URLs for the index, pages, and sections', () => {
    expect(capabilityPageUrl('README')).toBe('/docs/capabilities');
    expect(capabilityPageUrl('readme', { anchor: 'overview' })).toBe(
      '/docs/capabilities#overview',
    );
    expect(
      capabilityPageUrl('chat-and-research', { anchor: 'web-search' }),
    ).toBe('/docs/capabilities/chat-and-research#web-search');
  });

  it('fails closed for an oversized page instead of returning partial content', async () => {
    const catalog = createCapabilityCatalog(
      loader({
        'README.md': `# Index\n\n## Overview\n${'x'.repeat(200_001)}`,
      }),
    );

    await expect(catalog.search('overview')).resolves.toMatchObject({
      ok: false,
      kind: 'unavailable',
    });
  });
});
