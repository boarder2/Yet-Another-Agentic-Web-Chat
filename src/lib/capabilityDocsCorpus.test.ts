import { fileURLToPath } from 'node:url';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createHeadingAnchor,
  parseCapabilityMarkdown,
} from './capabilities/search';
import {
  CAPABILITY_DOC_FILENAMES,
  isExternalHref,
  type CapabilitySection,
} from './capabilities/types';

type SourceFile = {
  path: string;
  text: string;
};

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const capabilitiesRoot = resolve(repositoryRoot, 'docs/capabilities');
const capabilityFiles = CAPABILITY_DOC_FILENAMES;
const capabilityPages = capabilityFiles.filter((file) => file !== 'README.md');

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

/** Use the production parser so the corpus is checked against what ships. */
const parseHeadings = (markdown: string): CapabilitySection[] =>
  parseCapabilityMarkdown(markdown).sections;

const extractLinks = (markdown: string): string[] => {
  const links: string[] = [];
  const linkPattern = /\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+[^)]*)?\)/g;

  for (const match of markdown.matchAll(linkPattern)) {
    links.push(match[1].startsWith('<') ? match[1].slice(1, -1) : match[1]);
  }

  return links;
};

const assertInternalLinkResolves = (
  source: SourceFile,
  destination: string,
  headings: CapabilitySection[],
) => {
  if (isExternalHref(destination)) return;

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

/** Only the trees that carry documentation links; not the whole repository. */
const DOC_LINK_ROOTS = ['docs', '.claude', '.agents', 'e2e'];

const walkMarkdownFiles = (directory: string): string[] => {
  const paths: string[] = [];
  if (!existsSync(directory)) return paths;

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      paths.push(...walkMarkdownFiles(resolve(directory, entry.name)));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      paths.push(resolve(directory, entry.name));
    }
  }

  return paths;
};

const documentationMarkdownFiles = (): string[] => [
  ...readdirSync(repositoryRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => resolve(repositoryRoot, entry.name)),
  ...DOC_LINK_ROOTS.flatMap((root) =>
    walkMarkdownFiles(resolve(repositoryRoot, root)),
  ),
];

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

      // Anchors must be unique before the parser's dedupe suffix kicks in, so a
      // heading's anchor is derivable from its text alone.
      for (const { heading, anchor } of headings) {
        expect(
          createHeadingAnchor(heading),
          `${file} has a duplicate heading "${heading}"`,
        ).toBe(anchor);
      }
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

  it('has no repository link targeting the deleted docs/ui tree', () => {
    for (const file of documentationMarkdownFiles()) {
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
