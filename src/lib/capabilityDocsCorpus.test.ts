import { fileURLToPath } from 'node:url';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACCENTS, FLAVORS } from './theme/catppuccinPalette';
import { PRISM_STYLES, SYNTAX_STYLES } from './theme/syntax';
import { THEMES } from './theme/themes';

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
  'configuration.md',
  'files-and-workspaces.md',
  'models-and-providers.md',
  'personalization-and-memory.md',
  'privacy-and-data.md',
  'updating.md',
] as const;
const capabilityFiles = ['README.md', ...capabilityPages];
const githubMain =
  'https://github.com/boarder2/Yet-Another-Agentic-Web-Chat/blob/main/';
const expectedGithubLinks: Record<string, readonly string[]> = {
  'README.md': [`${githubMain}docs/THEMES.md`, `${githubMain}CONTRIBUTING.md`],
  'administration-and-settings.md': [`${githubMain}docs/THEMES.md`],
  'agent-capabilities.md': [],
  'artifacts-and-dashboards.md': [],
  'automation.md': [],
  'chat-and-research.md': [],
  'configuration.md': [],
  'files-and-workspaces.md': [],
  'models-and-providers.md': [],
  'personalization-and-memory.md': [],
  'privacy-and-data.md': [],
  'updating.md': [],
};

const sourceFiles = [
  'README.md',
  'AGENTS.md',
  'CONTRIBUTING.md',
  'docs/THEMES.md',
  '.github/pull_request_template.md',
  '.agents/skills/implement/SKILL.md',
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
  it('contains exactly the index and the agreed capability pages', () => {
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
      'configuration.md': [/DATA_DIR/i, /Docker/i, /TTS/i],
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
      'updating.md': [/release notes/i, /backup/i, /rollback/i],
    };

    for (const [file, terms] of Object.entries(requiredTerms)) {
      const source = sourceFiles.find(
        ({ path }) => path === `docs/capabilities/${file}`,
      );
      if (!source) throw new Error(`Missing test fixture for ${file}`);
      for (const term of terms) expect(source.text, file).toMatch(term);
    }
  });

  it('keeps the promoted operator guides as the only copies', () => {
    expect(existsSync(resolve(repositoryRoot, 'docs/installation'))).toBe(
      false,
    );
    expect(existsSync(resolve(repositoryRoot, 'docs/architecture'))).toBe(
      false,
    );
    expect(existsSync(resolve(capabilitiesRoot, 'configuration.md'))).toBe(
      true,
    );
    expect(existsSync(resolve(capabilitiesRoot, 'updating.md'))).toBe(true);
  });

  it('pins configuration inputs, defaults, precedence, and trust boundaries', () => {
    const configuration = readFileSync(
      resolve(capabilitiesRoot, 'configuration.md'),
      'utf8',
    );

    for (const input of [
      'CONFIG_PATH',
      'BASE_URL',
      'ENCRYPTION_PASSPHRASE',
      'SEARXNG_API_URL',
      'DATA_DIR',
      'PORT',
      'DOCKER_GID',
      'TTS_WORKER_DISABLED',
      'TTS_WORKER_CPUS',
      'TTS_RESERVED_CORES',
      'TTS_WORKER_NICE',
      'TTS_WORKER_IDLE_MS',
      'TTS_DTYPE',
      'TTS_DEBUG',
    ]) {
      expect(configuration, `missing operator input ${input}`).toContain(input);
    }

    for (const snippet of [
      '[GENERAL]',
      '[SECURITY]',
      '[TOOLS.CODE_EXECUTION]',
      'Environment variables are process inputs',
      'non-empty value overrides',
      'node:24-alpine',
      'unix:///var/run/docker.sock',
      '`30`',
      '`128`',
      '`50000`',
      'port `5005`',
      'interpolation fallback is `999`',
      '`600000` (10 minutes)',
      '`q4`',
      'credentials` table',
      'app_settings',
      'host-level trust boundary',
      'The sandbox drops capabilities',
      'fails closed',
      'BASE_URL` is an optional string and defaults to an empty string',
      'The application runtime defaults to `<working directory>/data`',
      "The Docker image and the repository's `dev`/`start` scripts use port `5005`",
      'Not read by YAAWC',
      '`1`, `true`, or `yes`',
      '25% of CPUs',
      '`15`',
      '`0` or a negative value keeps it alive',
      'CPU-list string',
    ]) {
      expect(
        configuration,
        `missing configuration contract: ${snippet}`,
      ).toContain(snippet);
    }

    expect(configuration).toContain(
      'the application reads the database from `<working directory>/data/db.sqlite`',
    );
    expect(configuration).toContain(
      'while `drizzle.config.ts` gives `drizzle-kit` `<working directory>/db.sqlite`',
    );
    expect(configuration).toContain('always use one explicit value');
    expect(configuration).toContain(
      '`config.toml` is separate from this directory',
    );
    expect(configuration).toContain(
      'ENCRYPTION_PASSPHRASE` is required for normal use',
    );
  });

  it('keeps update guidance timeless, backup-first, and recoverable', () => {
    const updating = readFileSync(
      resolve(capabilitiesRoot, 'updating.md'),
      'utf8',
    );

    for (const snippet of [
      'Review the release notes',
      'latest',
      'mutable channel',
      'pinned semver',
      'exact encryption passphrase',
      'config.toml',
      'uploads',
      'workspace-file',
      'docker compose down',
      'do not use `docker compose down -v`',
      'docker compose pull app',
      'docker compose up -d',
      'curl -f http://localhost:5005/api/config',
      'export DATA_DIR="$PWD/data"',
      'npm ci',
      'npm run build',
      'If a migration or start fails',
      'previous pinned Docker image',
      'pre-update database',
      'consistent set',
    ]) {
      expect(updating, `missing update contract: ${snippet}`).toContain(
        snippet,
      );
    }

    expect(updating).not.toMatch(/next release/i);
    expect(updating).not.toMatch(/release migration/i);
    expect(updating).toMatch(
      /backup[\s\S]*passphrase|passphrase[\s\S]*backup/i,
    );
  });

  it('keeps theme provenance guidance aligned with the current catalogue', () => {
    const themesGuide = readFileSync(
      resolve(repositoryRoot, 'docs/THEMES.md'),
      'utf8',
    );
    const darkCount = THEMES.filter(({ mode }) => mode === 'dark').length;
    const lightCount = THEMES.filter(({ mode }) => mode === 'light').length;
    const generatedCount = Object.keys(FLAVORS).length * ACCENTS.length;
    const familyCounts = new Map<string, number>();

    for (const theme of THEMES) {
      if (theme.family) {
        familyCounts.set(
          theme.family,
          (familyCounts.get(theme.family) ?? 0) + 1,
        );
      }
    }

    expect(themesGuide).toContain(`there are ${THEMES.length} built-ins`);
    expect(themesGuide).toContain(`${darkCount} dark`);
    expect(themesGuide).toContain(`${lightCount} light`);
    expect(themesGuide).toContain(`${generatedCount} generated entries`);
    expect(themesGuide).toContain('four flavours in all fourteen accents');
    expect(themesGuide).toContain(
      `${Object.keys(PRISM_STYLES).length} keys in both`,
    );
    expect(Object.keys(PRISM_STYLES)).toHaveLength(
      Object.keys(SYNTAX_STYLES).length,
    );

    for (const [family, count] of familyCounts) {
      expect(themesGuide, `missing theme family ${family}`).toContain(family);
      if (family === 'Catppuccin') {
        expect(themesGuide).toContain(`${count} generated entries`);
      } else if (count === 2) {
        expect(themesGuide).toContain('2 variants each');
      } else {
        expect(themesGuide).toContain(`${family} — ${count} variants`);
      }
    }
    for (const theme of THEMES.filter(({ family }) => !family)) {
      expect(themesGuide, `missing standalone theme ${theme.name}`).toContain(
        theme.name,
      );
    }

    const generatedNames = THEMES.filter(
      ({ family }) => family === 'Catppuccin',
    ).map(({ name }) => name);
    expect(generatedNames.some((name) => themesGuide.includes(name))).toBe(
      false,
    );

    for (const concept of [
      'maintainer and contributor reference',
      'canonical `source` URL',
      '## Fidelity and tests',
      '## Attribution',
      '## Adding a theme',
      '`PRISM_STYLES`',
      '`SYNTAX_STYLES`',
      '`SYNTAX_FAMILIES`',
      'npm run test:unit',
      'extend the shared palette table',
    ]) {
      expect(themesGuide, `missing theme-guide concept: ${concept}`).toContain(
        concept,
      );
    }
    expect(themesGuide).toContain(
      `${githubMain}docs/capabilities/administration-and-settings.md`,
    );
  });

  it('keeps contributor guidance and the pull-request template actionable', () => {
    const contributing = readFileSync(
      resolve(repositoryRoot, 'CONTRIBUTING.md'),
      'utf8',
    );
    const template = readFileSync(
      resolve(repositoryRoot, '.github/pull_request_template.md'),
      'utf8',
    );
    const packageJson = JSON.parse(
      readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'),
    ) as { scripts?: Record<string, string> };

    for (const heading of [
      '# Contributing',
      '## Set up',
      '## Required workflow',
      '## Pull requests',
    ]) {
      expect(contributing, `missing contributor heading: ${heading}`).toContain(
        heading,
      );
    }
    for (const command of [
      'db:push',
      'dev',
      'format:write',
      'lint',
      'test:unit',
      'test:e2e',
      'test',
      'db:generate',
    ]) {
      expect(
        packageJson.scripts?.[command],
        `missing npm script ${command}`,
      ).toEqual(expect.any(String));
      expect(contributing).toContain(`npm run ${command}`);
    }
    for (const setupRequirement of [
      'Node 24',
      'cp sample.config.toml config.toml',
      'npm install',
      'DATA_DIR',
      'npx tsc --noEmit',
      'docs/capabilities/README.md',
      'authoritative',
      'screenshot',
      'generated migration',
      'related issue is encouraged but optional',
    ]) {
      expect(
        contributing,
        `missing contributor requirement: ${setupRequirement}`,
      ).toMatch(
        new RegExp(
          setupRequirement.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
          'i',
        ),
      );
    }
    expect(contributing.split(/\r?\n/).length).toBeLessThan(80);
    for (const staleReference of [
      'docs/architecture',
      'docs/installation',
      'Project Structure',
      '/discover',
      '/api/chat',
      'SimplifiedAgent',
      'src/lib/search',
    ]) {
      expect(
        contributing,
        `stale contributor reference: ${staleReference}`,
      ).not.toContain(staleReference);
    }

    for (const heading of [
      '## Summary',
      '## Related issue (optional)',
      '## Validation',
      '## Tests (if applicable)',
      '## Documentation (if applicable)',
      '## UI screenshots (if applicable)',
      '## Database schema migration (if applicable)',
    ]) {
      expect(template, `missing PR-template heading: ${heading}`).toContain(
        heading,
      );
    }
    for (const field of [
      'What changed, and why?',
      'List the commands you ran and their results.',
      'I added or updated the relevant unit, API, or Playwright coverage.',
      'I reviewed and updated the relevant `docs/capabilities/` page.',
      'I attached before/after screenshots for the UI change.',
      'I ran `npm run db:generate` and included the generated migration.',
      'Not applicable — explain in Validation.',
    ]) {
      expect(template, `missing PR-template field: ${field}`).toContain(field);
    }
  });

  it('has no repository pointer to deleted installation, tracing, or architecture docs', () => {
    for (const source of sourceFiles) {
      expect(
        source.text,
        `${source.path} points to deleted documentation`,
      ).not.toMatch(/docs\/(?:installation|architecture)(?:\/|$)/i);
      expect(
        source.text,
        `${source.path} points to deleted tracing docs`,
      ).not.toMatch(/(?:^|\/)TRACING\.md(?:[#?)]|$)/);
    }

    for (const file of walkMarkdownFiles(repositoryRoot)) {
      const relativePath = file.slice(repositoryRoot.length + 1);
      for (const destination of extractLinks(readFileSync(file, 'utf8'))) {
        expect(
          destination,
          `${relativePath} points to deleted documentation`,
        ).not.toMatch(/(?:^|\/)docs\/(?:installation|architecture)(?:\/|$)/i);
        expect(
          destination,
          `${relativePath} points to deleted tracing docs`,
        ).not.toMatch(/(?:^|\/)TRACING\.md(?:[#?)]|$)/);
      }
    }
  });

  it('resolves every internal link and section fragment in the corpus', () => {
    for (const source of sourceFiles.filter(
      ({ path }) =>
        path === 'README.md' ||
        path === 'CONTRIBUTING.md' ||
        path === 'docs/THEMES.md' ||
        path.startsWith('docs/capabilities/'),
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
      '[configuration guide][cfg]\n\n[cfg]: ../outside/configuration.md';
    const [destination] = extractLinks(markdown);

    expect(destination).toBe('../outside/configuration.md');
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
    const agents = readFileSync(resolve(repositoryRoot, 'AGENTS.md'), 'utf8');
    expect(readme.split(/\r?\n/).length).toBeLessThan(100);
    for (const page of capabilityPages) {
      expect(readme).toContain(`docs/capabilities/${page}`);
    }
    expect(readme).toContain('docs/capabilities/configuration.md');
    expect(readme).toContain('docs/capabilities/updating.md');
    expect(readme).toContain('export DATA_DIR="$PWD/data"');
    expect(agents).toContain('Keep one explicit `DATA_DIR`');
    expect(agents).toContain('runtime and Drizzle defaults differ');
    expect(readme).not.toContain('docs/installation/');
    expect(readme).not.toContain('docs/architecture/');
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
