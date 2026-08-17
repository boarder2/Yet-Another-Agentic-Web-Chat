import { readFile } from 'node:fs/promises';
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

  it('includes the Markdown corpus in standalone and Docker builds', async () => {
    const [config, dockerfile] = await Promise.all([
      import('../../../next.config.mjs').then(
        (module) =>
          module.default as {
            outputFileTracingIncludes?: Record<string, string[]>;
          },
      ),
      readFile(new URL('../../../app.dockerfile', import.meta.url), 'utf8'),
    ]);

    expect(config.outputFileTracingIncludes?.['**']).toContain(
      './docs/capabilities/**/*.md',
    );
    const corpusCopy = 'COPY docs/capabilities ./docs/capabilities';
    expect(dockerfile).toContain(corpusCopy);
    expect(dockerfile.indexOf(corpusCopy)).toBeLessThan(
      dockerfile.indexOf('RUN npm run build'),
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

  it('retrieves Configuration and Updating guidance with bounded in-app URLs', async () => {
    const catalog = createCapabilityCatalog(filesystemCapabilityDocsLoader);

    const configurationPage = await catalog.getPage('configuration');
    expect(configurationPage.ok).toBe(true);
    if (!configurationPage.ok) return;
    expect(configurationPage.value.title).toBe('Configuration');
    expect(capabilityPageUrl(configurationPage.value)).toBe(
      '/docs/capabilities/configuration',
    );

    const configurationSearch = await catalog.search(
      'DATA_DIR Drizzle runtime defaults',
      {
        pageSlug: 'configuration',
        maxResults: 3,
        maxContentChars: 320,
      },
    );
    expect(configurationSearch.ok).toBe(true);
    if (!configurationSearch.ok) return;
    expect(
      configurationSearch.value.some(
        ({ section }) => section.anchor === 'data-directory',
      ),
    ).toBe(true);
    expect(
      configurationSearch.value.every(
        ({ section }) => section.content.length <= 320,
      ),
    ).toBe(true);

    const dataDirectory = await catalog.getSection(
      'configuration',
      'data-directory',
    );
    expect(dataDirectory.ok).toBe(true);
    if (!dataDirectory.ok) return;
    expect(dataDirectory.value.content).toContain('DATA_DIR');
    expect(
      capabilityPageUrl(configurationPage.value, {
        anchor: dataDirectory.value.anchor,
      }),
    ).toBe('/docs/capabilities/configuration#data-directory');

    const updatingPage = await catalog.getPage('updating');
    expect(updatingPage.ok).toBe(true);
    if (!updatingPage.ok) return;
    expect(updatingPage.value.title).toBe('Updating YAAWC');

    const updatingSearch = await catalog.search(
      'rollback after database migration',
      {
        pageSlug: 'updating',
        maxResults: 3,
        maxContentChars: 320,
      },
    );
    expect(updatingSearch.ok).toBe(true);
    if (!updatingSearch.ok) return;
    expect(
      updatingSearch.value.some(
        ({ section }) => section.anchor === 'verify-and-recover',
      ),
    ).toBe(true);
    expect(
      updatingSearch.value.every(
        ({ section }) => section.content.length <= 320,
      ),
    ).toBe(true);

    const beforeUpdate = await catalog.getSection(
      'updating',
      'before-an-update',
    );
    expect(beforeUpdate.ok).toBe(true);
    if (!beforeUpdate.ok) return;
    expect(beforeUpdate.value.content).toMatch(/backup/i);
    expect(
      capabilityPageUrl(updatingPage.value, {
        anchor: beforeUpdate.value.anchor,
      }),
    ).toBe('/docs/capabilities/updating#before-an-update');
  });

  it('searches the shipped corpus for the public code-widget construction contract', async () => {
    const catalog = createCapabilityCatalog(filesystemCapabilityDocsLoader);
    const result = await catalog.search(
      'construct a code widget with render and chart',
      {
        pageSlug: 'artifacts-and-dashboards',
        maxResults: 8,
        maxContentChars: 6_000,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const guidance = result.value.map((hit) => hit.section.content).join('\n');
    expect(guidance).toContain(
      'async function render({ sources, now, location, theme })',
    );
    expect(guidance).toContain('The global `chart(spec)` helper');
    expect(guidance).toContain('labels: Array<string | number>;');
    expect(guidance).toContain('normalized canonical specs');
    expect(guidance).toContain('`<Chart id="cN"/>`');
    expect(guidance).toContain('canonical-format input are rejected');
  });
});
