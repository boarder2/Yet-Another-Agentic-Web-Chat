import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE_EXTENSIONS = new Set(['.css', '.ts', '.tsx']);
const UI_ROOTS = [resolve('src/app'), resolve('src/components')];

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return SOURCE_EXTENSIONS.has(extname(path)) ? [path] : [];
  });
}

const uiFiles = UI_ROOTS.flatMap(sourceFiles).sort();

function occurrences(pattern: RegExp) {
  return uiFiles.flatMap((path) => {
    const source = readFileSync(path, 'utf8');
    return [...source.matchAll(pattern)].map((match) => ({
      path,
      line: source.slice(0, match.index).split('\n').length,
      value: match[0],
    }));
  });
}

type StringLiteral = { path: string; line: number; value: string };

/**
 * Motion utilities are authored in class strings, including Headless UI's
 * enter/leave attributes. Reading one source line at a time keeps this audit
 * deliberately lexical without pretending to be a TypeScript parser.
 */
function stringLiterals(): StringLiteral[] {
  const literal = /([\"'`])((?:(?!\1)[\s\S])*)\1/g;

  return uiFiles.flatMap((path) => {
    return readFileSync(path, 'utf8')
      .split('\n')
      .flatMap((text, index) =>
        [...text.matchAll(literal)].map((match) => ({
          path,
          line: index + 1,
          value: match[2],
        })),
      );
  });
}

function formatFindings(
  findings: Array<{ path: string; line: number; value: string }>,
) {
  return findings
    .map(({ path, line, value }) => `${path}:${line} ${value.trim()}`)
    .join('\n');
}

describe('semantic UI foreground audit', () => {
  it('does not reintroduce legacy textual foreground alpha classes', () => {
    const legacy = occurrences(
      /(?<![\w-])text-fg\/(?:30|35|40|50|60|70|80)(?![\w-])/g,
    );

    expect(
      legacy,
      legacy
        .map(({ path, line, value }) => `${path}:${line} ${value}`)
        .join('\n'),
    ).toEqual([]);
  });

  it('uses opacity-70 and opacity-75 only for state styling', () => {
    const stateOpacity = /opacity-(?:70|75)/g;
    const stateContext =
      /(?:aria-disabled|data-[\w-]+|disabled|pending|reveal|fade|animation|animate|enter|leave|hover|focus|loading|active|enabled)/i;
    const hierarchyOpacity = uiFiles.flatMap((path) => {
      const lines = readFileSync(path, 'utf8').split('\n');
      return lines.flatMap((text, index) => {
        if (!stateOpacity.test(text)) return [];
        stateOpacity.lastIndex = 0;
        return stateContext.test(text)
          ? []
          : [
              {
                path,
                line: index + 1,
                value: text.trim(),
              },
            ];
      });
    });

    expect(
      hierarchyOpacity,
      hierarchyOpacity
        .map(({ path, line, value }) => `${path}:${line} ${value}`)
        .join('\n'),
    ).toEqual([]);
  });
});

describe('explicit UI motion audit', () => {
  const literals = stringLiterals();
  const transitionProperty =
    /(?<![\w-])transition-(?:colors|opacity|transform|\[[^\]]+\])(?![\w-])/g;
  const numericDuration = /(?<![\w-])duration-(\d+)(?![\w-])/g;

  it('does not use broad transition utility classes', () => {
    const broad = literals.flatMap(({ path, line, value }) =>
      [...value.matchAll(/(?<![\w-])transition(?:-all)?(?![\w-])/g)].map(
        (match) => ({ path, line, value: match[0] }),
      ),
    );

    expect(broad, formatFindings(broad)).toEqual([]);
  });

  it('names the animated properties and uses declared durations', () => {
    const allowedProperties = new Set([
      'transition-colors',
      'transition-opacity',
      'transition-transform',
      'transition-[opacity,transform]',
      'transition-[width]',
    ]);
    const unsupported = literals.flatMap(({ path, line, value }) =>
      [...value.matchAll(transitionProperty)]
        .filter((match) => !allowedProperties.has(match[0]))
        .map((match) => ({ path, line, value: match[0] })),
    );
    const missingDuration = literals.flatMap(({ path, line, value }) => {
      const hasDuration = numericDuration.test(value);
      numericDuration.lastIndex = 0;
      return hasDuration
        ? []
        : [...value.matchAll(transitionProperty)].map((match) => ({
            path,
            line,
            value: match[0],
          }));
    });
    const undeclaredDuration = literals.flatMap(({ path, line, value }) =>
      [...value.matchAll(numericDuration)]
        .filter((match) => !new Set(['100', '150', '200']).has(match[1]))
        .map((match) => ({ path, line, value: match[0] })),
    );

    expect(unsupported, formatFindings(unsupported)).toEqual([]);
    expect(missingDuration, formatFindings(missingDuration)).toEqual([]);
    expect(undeclaredDuration, formatFindings(undeclaredDuration)).toEqual([]);
  });

  it('keeps the agreed motion contracts for directional UI', () => {
    const source = (relativePath: string) =>
      readFileSync(resolve(relativePath), 'utf8');

    const modal = source('src/components/ui/Modal.tsx');
    expect(modal).toMatch(/transition-opacity[^'\"`]*duration-200/);
    expect(modal).toMatch(
      /transition-\[opacity,transform\][^'\"`]*duration-200[^'\"`]*ease-standard/,
    );

    const appSwitch = source('src/components/ui/AppSwitch.tsx');
    expect(appSwitch).toMatch(/transition-colors[^'\"`]*duration-150/);
    expect(appSwitch).toMatch(
      /transition-transform[^'\"`]*duration-200[^'\"`]*ease-standard/,
    );

    expect(
      source('src/components/MessageInputActions/ContextIndicator.tsx'),
    ).toMatch(/transition-\[width\][^'\"`]*duration-200/);
    expect(source('src/components/Workspaces/WorkspaceShell.tsx')).toMatch(
      /transition-\[width\][^'\"`]*duration-200/,
    );
    for (const imagePath of [
      'src/components/SearchImages.tsx',
      'src/components/SearchVideos.tsx',
    ]) {
      expect(source(imagePath), imagePath).toMatch(
        /transition-transform[^'\"`]*duration-200/,
      );
    }

    // MessageTabs contains a real color transition for its controls, but no
    // wrapper-wide transition that would animate unrelated layout properties.
    const messageTabsBroad = literals
      .filter(({ path }) => path.endsWith('/components/MessageTabs.tsx'))
      .flatMap(({ path, line, value }) =>
        [...value.matchAll(/(?<![\w-])transition(?:-all)?(?![\w-])/g)].map(
          (match) => ({ path, line, value: match[0] }),
        ),
      );
    expect(messageTabsBroad, formatFindings(messageTabsBroad)).toEqual([]);
  });
});
