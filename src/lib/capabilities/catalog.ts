import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  CAPABILITY_DOC_FILENAMES,
  CAPABILITY_DOC_MAX_PAGE_LENGTH,
  CAPABILITY_DOC_MAX_QUERY_LENGTH,
  CapabilityDocsLoader,
  CapabilityPage,
  CapabilityResult,
  CapabilitySearchHit,
  CapabilitySearchOptions,
  isValidSectionAnchor,
} from './types';
import {
  getSectionByAnchor,
  parseCapabilityMarkdown,
  searchCapabilitySections,
} from './search';

export type { CapabilityDocsLoader } from './types';

const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9-]*\.md$/;
const SAFE_SLUG = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
const CORPUS_UNAVAILABLE_MESSAGE =
  'YAAWC capability documentation is unavailable.';
const INVALID_INPUT_MESSAGE =
  'The capability-document lookup request is invalid.';
const NO_MATCH_MESSAGE =
  'No matching YAAWC capability documentation was found.';

export const capabilityDocsDirectory = path.join(
  process.cwd(),
  'docs',
  'capabilities',
);

function isSafeCapabilityFilename(filename: string): boolean {
  return (
    typeof filename === 'string' &&
    filename.length <= 160 &&
    SAFE_FILENAME.test(filename) &&
    !filename.includes('..')
  );
}

function capabilitySlugFromFilename(filename: string): string | null {
  if (!isSafeCapabilityFilename(filename)) return null;
  if (filename === 'README.md') return 'README';
  return filename.slice(0, -'.md'.length);
}

export function capabilityFilenameFromSlug(slug: string): string | null {
  if (typeof slug !== 'string' || slug.length > 160 || !SAFE_SLUG.test(slug))
    return null;
  if (slug === 'README' || slug.toLocaleLowerCase() === 'readme') {
    return 'README.md';
  }
  return `${slug}.md`;
}

/** The corpus root never moves within a process; resolve its realpath once. */
let realCorpusRootPromise: Promise<string> | undefined;
function realCorpusRoot(): Promise<string> {
  realCorpusRootPromise ??= fs.realpath(path.resolve(capabilityDocsDirectory));
  return realCorpusRootPromise;
}

/** The production adapter reads only direct, catalogued Markdown filenames. */
export const filesystemCapabilityDocsLoader: CapabilityDocsLoader = {
  async listFiles() {
    const entries = await fs.readdir(capabilityDocsDirectory, {
      withFileTypes: true,
    });
    const present = new Set(
      entries
        .filter(
          (entry) => entry.isFile() && isSafeCapabilityFilename(entry.name),
        )
        .map((entry) => entry.name),
    );
    if (CAPABILITY_DOC_FILENAMES.some((filename) => !present.has(filename))) {
      throw new Error('Capability documentation corpus is incomplete');
    }
    return CAPABILITY_DOC_FILENAMES;
  },
  async readFile(filename: string) {
    if (!isSafeCapabilityFilename(filename)) {
      throw new Error('Invalid capability documentation filename');
    }
    const corpusRoot = path.resolve(capabilityDocsDirectory);
    const resolved = path.resolve(corpusRoot, filename);
    if (path.dirname(resolved) !== corpusRoot) {
      throw new Error('Invalid capability documentation path');
    }
    const realRoot = await realCorpusRoot();
    const realFile = await fs.realpath(resolved);
    if (
      realFile !== realRoot &&
      !realFile.startsWith(`${realRoot}${path.sep}`)
    ) {
      throw new Error('Invalid capability documentation path');
    }
    return fs.readFile(realFile, 'utf8');
  },
};

function invalidResult<T>(): CapabilityResult<T> {
  return { ok: false, kind: 'invalid', message: INVALID_INPUT_MESSAGE };
}

function noMatchResult<T>(): CapabilityResult<T> {
  return { ok: false, kind: 'no_match', message: NO_MATCH_MESSAGE };
}

function unavailableResult<T>(): CapabilityResult<T> {
  return {
    ok: false,
    kind: 'unavailable',
    message: CORPUS_UNAVAILABLE_MESSAGE,
  };
}

function uniqueSafeFiles(files: readonly string[]): string[] {
  const fixedFiles = new Set<string>(CAPABILITY_DOC_FILENAMES);
  return [...new Set(files)].filter(
    (filename) =>
      fixedFiles.has(filename) && isSafeCapabilityFilename(filename),
  );
}

export class CapabilityDocsCatalog {
  private readonly loader: CapabilityDocsLoader;
  private snapshotPromise?: Promise<CapabilityResult<CapabilityPage[]>>;

  constructor(loader: CapabilityDocsLoader = filesystemCapabilityDocsLoader) {
    this.loader = loader;
  }

  async load(): Promise<CapabilityResult<CapabilityPage[]>> {
    if (!this.snapshotPromise) {
      this.snapshotPromise = this.loadSnapshot();
    }
    return this.snapshotPromise;
  }

  private async loadSnapshot(): Promise<CapabilityResult<CapabilityPage[]>> {
    try {
      const listed = uniqueSafeFiles(await this.loader.listFiles());
      if (listed.length === 0) return unavailableResult();

      const sources = await Promise.all(
        listed.map(async (filename) => ({
          filename,
          markdown: await this.loader.readFile(filename),
        })),
      );

      const pages: CapabilityPage[] = [];
      for (const { filename, markdown } of sources) {
        if (
          typeof markdown !== 'string' ||
          markdown.length > CAPABILITY_DOC_MAX_PAGE_LENGTH
        ) {
          return unavailableResult();
        }
        const slug = capabilitySlugFromFilename(filename);
        if (!slug) continue;
        pages.push(parseCapabilityMarkdown(markdown, { slug, filename }));
      }
      return pages.length > 0
        ? { ok: true, value: pages }
        : unavailableResult();
    } catch {
      // Do not leak adapter errors, absolute paths, or deployment details to the
      // model. A missing corpus is a grounding failure, never a reason to guess.
      return unavailableResult();
    }
  }

  async listPages(): Promise<CapabilityPage[]> {
    const result = await this.load();
    if (!result.ok) throw new Error(result.message);
    return result.value;
  }

  async getPage(slug: string): Promise<CapabilityResult<CapabilityPage>> {
    const filename = capabilityFilenameFromSlug(slug);
    if (!filename) return invalidResult();
    const result = await this.load();
    if (!result.ok) return result;
    const page = result.value.find(
      (candidate) => candidate.filename === filename,
    );
    return page ? { ok: true, value: page } : noMatchResult();
  }

  async getSection(
    slug: string,
    anchor: string,
  ): Promise<CapabilityResult<CapabilityPage['sections'][number]>> {
    if (!capabilityFilenameFromSlug(slug)) return invalidResult();
    if (!isValidSectionAnchor(anchor)) return invalidResult();
    const page = await this.getPage(slug);
    if (!page.ok) return page;
    const section = getSectionByAnchor(page.value, anchor);
    return section ? { ok: true, value: section } : noMatchResult();
  }

  async search(
    query: string,
    options: CapabilitySearchOptions = {},
  ): Promise<CapabilityResult<CapabilitySearchHit[]>> {
    if (
      typeof query !== 'string' ||
      query.length > CAPABILITY_DOC_MAX_QUERY_LENGTH
    ) {
      return invalidResult();
    }
    if (
      options.pageSlug !== undefined &&
      !capabilityFilenameFromSlug(options.pageSlug)
    ) {
      return invalidResult();
    }
    if (
      options.sectionAnchor !== undefined &&
      !isValidSectionAnchor(options.sectionAnchor)
    ) {
      return invalidResult();
    }

    const result = await this.load();
    if (!result.ok) return result;
    let pages = result.value;
    if (options.pageSlug) {
      const filename = capabilityFilenameFromSlug(options.pageSlug);
      pages = pages.filter((page) => page.filename === filename);
    }

    let sections = pages.flatMap((page) => page.sections);
    if (options.sectionAnchor) {
      sections = sections.filter(
        (section) => section.anchor === options.sectionAnchor,
      );
    }

    const hits = searchCapabilitySections(sections, query, options);
    return hits.length > 0 ? { ok: true, value: hits } : noMatchResult();
  }
}

export function createCapabilityCatalog(
  loader: CapabilityDocsLoader = filesystemCapabilityDocsLoader,
): CapabilityDocsCatalog {
  return new CapabilityDocsCatalog(loader);
}

let defaultCatalog: CapabilityDocsCatalog | undefined;

export function getCapabilityDocsCatalog(): CapabilityDocsCatalog {
  defaultCatalog ??= createCapabilityCatalog();
  return defaultCatalog;
}

export function setCapabilityDocsCatalogForTests(
  catalog: CapabilityDocsCatalog,
): void {
  defaultCatalog = catalog;
}
