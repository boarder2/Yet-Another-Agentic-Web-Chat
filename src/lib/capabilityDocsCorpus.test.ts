import { fileURLToPath } from 'node:url';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

type Heading = {
  level: number;
  text: string;
  anchor: string;
};

type SourceFile = {
  path: string;
  text: string;
};

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const capabilitiesRoot = resolve(repositoryRoot, 'docs/capabilities');
const capabilityPages = [
  'administration-and-settings.md',
  'agent-capabilities.md',
  'artifacts-and-dashboards.md',
  'automation.md',
  'chat-and-research.md',
  'files-and-workspaces.md',
  'models-and-providers.md',
  'personalization-and-memory.md',
  'privacy-and-data.md',
] as const;
const capabilityFiles = ['README.md', ...capabilityPages];
const githubMain =
  'https://github.com/boarder2/Yet-Another-Agentic-Web-Chat/blob/main/';
const expectedGithubLinks: Record<string, readonly string[]> = {
  'README.md': [
    `${githubMain}docs/installation/configuration.md`,
    `${githubMain}docs/installation/UPDATING.md`,
    `${githubMain}docs/installation/TRACING.md`,
    `${githubMain}docs/THEMES.md`,
    `${githubMain}docs/architecture/README.md`,
    `${githubMain}CONTRIBUTING.md`,
  ],
  'administration-and-settings.md': [
    `${githubMain}docs/THEMES.md`,
    `${githubMain}docs/installation/configuration.md`,
    `${githubMain}docs/installation/UPDATING.md`,
  ],
  'agent-capabilities.md': [`${githubMain}docs/installation/configuration.md`],
  'artifacts-and-dashboards.md': [
    `${githubMain}docs/installation/configuration.md`,
  ],
  'automation.md': [],
  'chat-and-research.md': [],
  'files-and-workspaces.md': [],
  'models-and-providers.md': [
    `${githubMain}docs/installation/configuration.md`,
  ],
  'personalization-and-memory.md': [],
  'privacy-and-data.md': [],
};

const sourceFiles = [
  'README.md',
  'AGENTS.md',
  '.agents/skills/implement/SKILL.md',
  'docs/architecture/README.md',
  'docs/architecture/WORKING.md',
  ...capabilityFiles.map((file) => `docs/capabilities/${file}`),
].map((relativePath): SourceFile => ({
  path: relativePath,
  text: readFileSync(resolve(repositoryRoot, relativePath), 'utf8'),
}));

const parseHeadings = (markdown: string): Heading[] => {
  const headings: Heading[] = [];
  const usedAnchors = new Map<string, number>();
  let inFence = false;

  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const match = /^(#{1,6})[ \t]+(.+?)[ \t]*$/.exec(line);
    if (!match) continue;

    const text = match[2].replace(/[ \t]+#+[ \t]*$/, '').trim();
    const baseAnchor = text
      .toLowerCase()
      .replace(/[\u0060*_~]/g, '')
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-');
    const occurrence = usedAnchors.get(baseAnchor) ?? 0;
    usedAnchors.set(baseAnchor, occurrence + 1);

    headings.push({
      level: match[1].length,
      text,
      anchor: occurrence === 0 ? baseAnchor : `${baseAnchor}-${occurrence}`,
    });
  }

  return headings;
};

const normalizeReferenceLabel = (label: string) =>
  label.trim().replace(/\s+/g, ' ').toLowerCase();

const extractLinks = (markdown: string): string[] => {
  const definitions = new Map<string, string>();
  const definitionPattern =
    /^[ \t]{0,3}\[([^\]\r\n]+)\]:[ \t]*(<[^>\r\n]*>|[^ \t\r\n]+)(?:[ \t]+.*)?$/gm;

  for (const match of markdown.matchAll(definitionPattern)) {
    const rawDestination = match[2];
    definitions.set(
      normalizeReferenceLabel(match[1]),
      rawDestination.startsWith('<')
        ? rawDestination.slice(1, -1)
        : rawDestination,
    );
  }

  const locatedLinks: Array<{ index: number; destination: string }> = [];
  const addReferenceLink = (index: number, label: string) => {
    const destination = definitions.get(normalizeReferenceLabel(label));
    if (destination) locatedLinks.push({ index, destination });
  };

  const inlineLinkPattern = /\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+[^)]*)?\)/g;
  for (const match of markdown.matchAll(inlineLinkPattern)) {
    const rawDestination = match[1];
    locatedLinks.push({
      index: match.index,
      destination: rawDestination.startsWith('<')
        ? rawDestination.slice(1, -1)
        : rawDestination,
    });
  }

  const referenceLinkPattern = /\[([^\]\r\n]+)\][ \t]*\[([^\]\r\n]*)\]/g;
  for (const match of markdown.matchAll(referenceLinkPattern)) {
    if (match.index > 0 && markdown[match.index - 1] === '!') continue;
    addReferenceLink(match.index, match[2] || match[1]);
  }

  const shortcutReferencePattern =
    /(^|[^\w!])\[([^\]\r\n]+)\](?![ \t]*[:\[(])/gm;
  for (const match of markdown.matchAll(shortcutReferencePattern)) {
    addReferenceLink(match.index + match[1].length, match[2]);
  }

  return locatedLinks
    .sort((left, right) => left.index - right.index)
    .map(({ destination }) => destination);
};

const isExternalLink = (destination: string) =>
  /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(destination);

const assertInternalLinkResolves = (
  source: SourceFile,
  destination: string,
  headings: Heading[],
) => {
  if (isExternalLink(destination)) return;

  const hashIndex = destination.indexOf('#');
  const pathPart =
    hashIndex === -1 ? destination : destination.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? '' : destination.slice(hashIndex + 1);
  const targetPath = pathPart
    ? resolve(
        dirname(resolve(repositoryRoot, source.path)),
        decodeURIComponent(pathPart),
      )
    : resolve(repositoryRoot, source.path);

  expect(
    existsSync(targetPath) && statSync(targetPath).isFile(),
    `${source.path} links to missing source file ${destination}`,
  ).toBe(true);

  if (fragment) {
    const decodedFragment = decodeURIComponent(fragment);
    expect(
      headings.map((heading) => heading.anchor),
      `${source.path} links to missing heading ${destination}`,
    ).toContain(decodedFragment);
  }
};

const walkMarkdownFiles = (directory: string): string[] => {
  const ignoredDirectories = new Set(['.git', '.next', 'node_modules']);
  const paths: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) continue;
      paths.push(...walkMarkdownFiles(resolve(directory, entry.name)));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      paths.push(resolve(directory, entry.name));
    }
  }

  return paths;
};

describe('authoritative capability corpus', () => {
  it('contains exactly the index and the nine agreed capability pages', () => {
    expect(existsSync(capabilitiesRoot)).toBe(true);
    expect(
      readdirSync(capabilitiesRoot)
        .filter((file) => file.endsWith('.md'))
        .sort(),
    ).toEqual([...capabilityFiles].sort());
    expect(existsSync(resolve(repositoryRoot, 'docs/ui'))).toBe(false);
  });

  it('keeps every page readable with a stable heading structure', () => {
    for (const file of capabilityFiles) {
      const source = sourceFiles.find(
        ({ path }) => path === `docs/capabilities/${file}`,
      );
      if (!source) throw new Error(`Missing test fixture for ${file}`);

      const headings = parseHeadings(source.text);
      expect(headings[0]?.level, `${file} must start with an H1`).toBe(1);
      expect(
        headings.filter(({ level }) => level === 1),
        `${file} must have one title`,
      ).toHaveLength(1);
      expect(
        headings.filter(({ level }) => level === 2).length,
        `${file} needs task-oriented sections`,
      ).toBeGreaterThan(0);

      for (let index = 1; index < headings.length; index += 1) {
        expect(
          headings[index].level,
          `${file} jumps from H${headings[index - 1].level} to H${headings[index].level}`,
        ).toBeLessThanOrEqual(headings[index - 1].level + 1);
      }

      expect(
        new Set(headings.map(({ anchor }) => anchor)).size,
        `${file} has duplicate section anchors`,
      ).toBe(headings.length);
      expect(source.text).not.toMatch(/!\[[^\]]*\]\([^)]*\)/);
      expect(source.text).not.toMatch(/<img\b/i);
      expect(source.text).not.toMatch(
        /^#{1,6}\s+(?:roadmap|changelog|coming soon|future work)\b/im,
      );
    }
  });

  it('covers each agreed capability area with task-oriented content', () => {
    const requiredTerms: Record<(typeof capabilityPages)[number], RegExp[]> = {
      'administration-and-settings.md': [/MCP/i, /Retention/i, /Voice/i],
      'agent-capabilities.md': [
        /Deep research/i,
        /approval/i,
        /code execution/i,
      ],
      'artifacts-and-dashboards.md': [/artifact/i, /dashboard/i, /widget/i],
      'automation.md': [/workflow/i, /schedule/i, /headless/i],
      'chat-and-research.md': [/Web Search/i, /Local Research/i, /citation/i],
      'files-and-workspaces.md': [/attachment/i, /workspace/i, /file/i],
      'models-and-providers.md': [
        /Chat and System/i,
        /embedding/i,
        /search provider/i,
      ],
      'personalization-and-memory.md': [
        /Personalization/i,
        /memory/i,
        /private session/i,
      ],
      'privacy-and-data.md': [
        /external service/i,
        /Private sessions/i,
        /Retention/i,
      ],
    };

    for (const [file, terms] of Object.entries(requiredTerms)) {
      const source = sourceFiles.find(
        ({ path }) => path === `docs/capabilities/${file}`,
      );
      if (!source) throw new Error(`Missing test fixture for ${file}`);
      for (const term of terms) expect(source.text, file).toMatch(term);
    }
  });

  it('resolves every internal link and section fragment in the corpus', () => {
    for (const source of sourceFiles.filter(
      ({ path }) =>
        path === 'README.md' ||
        path.startsWith('docs/capabilities/') ||
        path.startsWith('docs/architecture/'),
    )) {
      const headings = parseHeadings(source.text);
      for (const destination of extractLinks(source.text)) {
        assertInternalLinkResolves(source, destination, headings);
      }
    }
  });

  it('keeps relative capability links in-corpus and pins repository links to GitHub main', () => {
    for (const file of capabilityFiles) {
      const source = sourceFiles.find(
        ({ path }) => path === `docs/capabilities/${file}`,
      );
      if (!source) throw new Error(`Missing test fixture for ${file}`);

      const externalLinks = extractLinks(source.text).filter(isExternalLink);
      expect(externalLinks, `${file} repository references`).toEqual(
        expectedGithubLinks[file],
      );
      for (const destination of externalLinks) {
        expect(destination).toMatch(new RegExp(`^${githubMain}`));
      }

      for (const destination of extractLinks(source.text)) {
        if (isExternalLink(destination)) continue;
        const hashIndex = destination.indexOf('#');
        const pathPart =
          hashIndex === -1 ? destination : destination.slice(0, hashIndex);
        if (!pathPart) continue;

        const targetPath = resolve(
          dirname(resolve(repositoryRoot, source.path)),
          decodeURIComponent(pathPart),
        );
        const relativeTarget = relative(capabilitiesRoot, targetPath);
        expect(
          relativeTarget === '' ||
            (relativeTarget !== '..' && !relativeTarget.startsWith(`..${sep}`)),
          `${source.path} relative link escapes docs/capabilities: ${destination}`,
        ).toBe(true);
      }
    }
  });

  it('recognizes reference-style links before applying the corpus boundary policy', () => {
    const markdown =
      '[configuration guide][cfg]\n\n[cfg]: ../installation/configuration.md';
    const [destination] = extractLinks(markdown);

    expect(destination).toBe('../installation/configuration.md');
    if (!destination) throw new Error('Reference link was not extracted');

    const targetPath = resolve(
      dirname(resolve(repositoryRoot, 'docs/capabilities/README.md')),
      destination,
    );
    const relativeTarget = relative(capabilitiesRoot, targetPath);
    expect(
      relativeTarget === '..' || relativeTarget.startsWith(`..${sep}`),
    ).toBe(true);
  });

  it('pins the public code-widget contract, limits, and defensive example', () => {
    const source = sourceFiles.find(
      ({ path }) => path === 'docs/capabilities/artifacts-and-dashboards.md',
    );
    if (!source) throw new Error('Missing code-widget capability page');

    const markdown = source.text;
    for (const snippet of [
      'async function render({ sources, now, location, theme })',
      'url: string;',
      "type: 'Web Page' | 'HTTP Data';",
      'content: string;',
      'error?: string;',
      'ok: boolean;',
      'truncated: boolean;',
      'iso: string, utcIso: string, localIso: string',
      'string | null',
      "mode: 'light' | 'dark';",
      'background: string;',
      'accentForeground: string;',
      'danger: string;',
      'success: string;',
      'warning: string;',
      'info: string;',
      'non-empty Markdown string',
      'sanitized',
      'Inline `style` attributes are allowed and pass through without CSS sanitization',
      'including `url(...)` values',
      'treat them as trusted and do not interpolate untrusted URLs or CSS',
      'A failed source',
      '`render` throws',
      'The global `chart(spec)` helper',
      'assigns an id in call order',
      '`<Chart id="cN"/>`',
      'After `render` returns, the runtime validates every registered specification',
      '`chart()` itself does not throw for an invalid spec',
      'fails the widget afterward rather than being catchable around the call',
      'for non-pie charts, a legend appears only when it is true and there are multiple series',
      "type: 'bar' | 'line' | 'area' | 'pie';",
      'data: Array<Record<string, string | number>>;',
      'key: string;',
      'label?: string;',
      'color?: string;',
      'stackId?: string;',
      'xKey?: string;',
      "orientation?: 'vertical' | 'horizontal';",
      'donut?: boolean;',
      'showLegend?: boolean;',
      'showGrid?: boolean;',
      'yLabel?: string;',
      'xLabel?: string;',
      'yMin?: number;',
      'yMax?: number;',
      'must contain exactly one entry',
      '`name` field',
      'effective `xKey`',
      'valid CSS color',
      'six decimal places',
      'const inputSources = Array.isArray(sources) ? sources : [];',
      'const failed = inputSources.filter((source) => !source.ok);',
      'const chartMarkdown = chart({',
      'color: theme.colors.accent,',
      'chartMarkdown,',
    ]) {
      expect(markdown, `missing code-widget contract: ${snippet}`).toContain(
        snippet,
      );
    }

    expect(markdown).toMatch(
      /\*\*`now`\*\* is `\{ iso: string, utcIso: string, localIso: string \}`/,
    );
    expect(markdown).toMatch(/\*\*`location`\*\* is `string \| null`/);

    for (const limit of [
      /Sources per widget\s+\|\s+8/,
      /Retained characters per source\s+\|\s+2,000,000/,
      /Retained source characters total\s+\|\s+4,000,000/,
      /Widget output\/result envelope\s+\|\s+512,000/,
      /Charts per widget\s+\|\s+10/,
      /Data rows per chart\s+\|\s+1,000/,
      /Series per chart\s+\|\s+20/,
      /Bounded chart strings\s+\|\s+500 characters/,
    ]) {
      expect(markdown).toMatch(limit);
    }
    expect(markdown).toContain('TOOLS.CODE_EXECUTION.TIMEOUT_SECONDS');
    expect(markdown).toContain('TOOLS.CODE_EXECUTION.MEMORY_MB');
    expect(markdown).toContain('30 seconds and 128 MB');

    const codeFences = markdown.match(/```[\s\S]*?```/g) ?? [];
    expect(
      codeFences.some((fence) => /code_execution|input_schema/i.test(fence)),
    ).toBe(false);
  });

  it('has no repository link targeting the deleted docs/ui tree', () => {
    for (const file of walkMarkdownFiles(repositoryRoot)) {
      const relativePath = file.slice(repositoryRoot.length + 1);
      for (const destination of extractLinks(readFileSync(file, 'utf8'))) {
        expect(
          destination.replaceAll('\\', '/'),
          `${relativePath} contains a docs/ui link`,
        ).not.toMatch(/(?:^|\/)docs\/ui(?:\/|$)/);
      }
    }
  });

  it('keeps README concise while retaining the essential project pointers', () => {
    const readme = readFileSync(resolve(repositoryRoot, 'README.md'), 'utf8');
    expect(readme.split(/\r?\n/).length).toBeLessThan(100);
    for (const page of capabilityPages) {
      expect(readme).toContain(`docs/capabilities/${page}`);
    }
    expect(readme).toContain('docs/installation/configuration.md');
    expect(readme).toContain('CONTRIBUTING.md');
    expect(readme).toContain('LICENSE');
  });

  it('requires the capability-document review rule in contributor guidance', () => {
    const agents = readFileSync(resolve(repositoryRoot, 'AGENTS.md'), 'utf8');
    const implementSkill = readFileSync(
      resolve(repositoryRoot, '.agents/skills/implement/SKILL.md'),
      'utf8',
    );

    for (const guidance of [agents, implementSkill]) {
      expect(guidance).toMatch(/user-visible change/i);
      expect(guidance).toMatch(/docs\/capabilities/);
      expect(guidance).toMatch(/authoritative/i);
      expect(guidance).toMatch(/(?:history|roadmap)/i);
    }
  });
});
