#!/usr/bin/env node
// UI consistency census. Zero dependencies, stdlib only.
// Usage: node census.mjs [--root DIR] [--flavor auto|utility|modules|cssinjs|declarations]
//                        [--area DIR ...] [--json] [--top N] [--shingle K]

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname, relative, sep } from 'node:path';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : args[i + 1];
};
const has = (name) => args.includes(`--${name}`);

const ROOT = flag('root', process.cwd());
const TOP = Number(flag('top', 25));
const K = Number(flag('shingle', 8));
const AREAS = args.reduce(
  (acc, a, i) => (a === '--area' ? [...acc, args[i + 1]] : acc),
  [],
);

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'dist',
  'build',
  'out',
  'coverage',
  'vendor',
  '__snapshots__',
  '.venv',
  'target',
  'public',
  'playwright-report',
  'test-results',
  'storybook-static',
  '.cache',
  '.turbo',
]);

// Minified/generated files carry thousands of phantom declarations and would
// drown the baseline. Long lines are the reliable cross-language tell.
const looksGenerated = (name, text) =>
  /\.min\.(css|js)$/.test(name) ||
  /^(\s*\/[/*]\s*)?(GENERATED|AUTO-GENERATED|@generated)/im.test(
    text.slice(0, 500),
  ) ||
  text.split('\n').some((l) => l.length > 5000);
const MARKUP_EXT = new Set([
  '.tsx',
  '.jsx',
  '.vue',
  '.svelte',
  '.astro',
  '.html',
  '.htm',
  '.erb',
  '.razor',
]);
const STYLE_EXT = new Set(['.css', '.scss', '.sass', '.less', '.styl']);
const CODE_EXT = new Set(['.ts', '.js', '.mts', '.mjs']);
const ALL_EXT = new Set([...MARKUP_EXT, ...STYLE_EXT, ...CODE_EXT]);

/* ---------------------------------------------------------------- walking */

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name) || (name.startsWith('.') && name !== '.')) continue;
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (ALL_EXT.has(extname(name)) && st.size < 1_000_000) out.push(full);
  }
  return out;
}

const read = (f) => {
  try {
    return readFileSync(f, 'utf8');
  } catch {
    return '';
  }
};

// The baseline (styling flavor, token definitions) is always repo-wide — a
// scoped run still has to know what the project's design system is.
const walked = walk(ROOT);
const allSources = new Map(
  walked
    .map((f) => [f, read(f)])
    .filter(([f, text]) => text && !looksGenerated(f, text)),
);
const allFiles = [...allSources.keys()];

const areaRoots = AREAS.map((a) => join(ROOT, a)).filter(existsSync);
const files = areaRoots.length
  ? [...new Set(areaRoots.flatMap((r) => walk(r)))].filter((f) =>
      allSources.has(f),
    )
  : allFiles;
const sources = areaRoots.length
  ? new Map(files.map((f) => [f, allSources.get(f)]))
  : allSources;
const rel = (f) => relative(ROOT, f).split(sep).join('/');
const lineAt = (text, index) => text.slice(0, index).split('\n').length;

/* ---------------------------------------------------------------- flavor */

function detectFlavor() {
  const forced = flag('flavor', 'auto');
  if (forced !== 'auto') return forced;
  const names = walked.map(rel); // pre-filter: an empty .module.css still signals flavor
  const blob = [...allSources.values()].join('\n');
  if (
    names.some((n) => /tailwind\.config\.[cm]?[jt]s$/.test(n)) ||
    /@theme\b|@tailwind\b|@import\s+['"]tailwindcss/.test(blob)
  )
    return 'utility';
  if (names.some((n) => /\.module\.(css|scss|sass|less)$/.test(n)))
    return 'modules';
  if (
    /from\s+['"](styled-components|@emotion\/[a-z]+|@stitches\/[a-z]+)['"]/.test(
      blob,
    )
  )
    return 'cssinjs';
  return 'declarations';
}
const FLAVOR = detectFlavor();

/* ---------------------------------------------------------------- helpers */

const tally = () => new Map();
function bump(map, key, file, line) {
  let e = map.get(key);
  if (!e) map.set(key, (e = { key, count: 0, sites: [] }));
  e.count++;
  if (e.sites.length < 12) e.sites.push(`${rel(file)}:${line}`);
  return e;
}
const rank = (map, min = 1) =>
  [...map.values()]
    .filter((e) => e.count >= min)
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
const distinctFiles = (e) => new Set(e.sites.map((s) => s.split(':')[0])).size;

function scan(text, re, fn) {
  re.lastIndex = 0;
  for (let m; (m = re.exec(text));) fn(m);
}

/* ---------------------------------------------------------- raw literals */

const RE = {
  hex: /#[0-9a-fA-F]{3,8}\b/g,
  fn: /\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(\s*[^)]{1,80}\)/g,
  size: /(?<![\w.-])\d+(?:\.\d+)?(px|rem|em)(?![\w-])/g,
  cssVarDef: /(--[\w-]+)\s*:\s*([^;{}]+);/g,
  cssVarUse: /var\(\s*(--[\w-]+)/g,
  classAttr:
    /(?:className|class)\s*=\s*(?:"([^"]{2,400})"|'([^']{2,400})'|\{\s*`([^`]{2,400})`\s*\})/g,
  arbitrary: /\[[^\]\s]{2,60}\]/g,
  fontFamily: /font-family\s*:\s*([^;{}]+)/gi,
  fontSize: /font-size\s*:\s*([^;{}]+)/gi,
  radius: /border-radius\s*:\s*([^;{}]+)/gi,
  shadow: /box-shadow\s*:\s*([^;{}]+)/gi,
  transition: /transition(?:-duration)?\s*:\s*([^;{}]+)/gi,
};

const colors = tally();
const sizes = tally();
const arbitrary = tally();
const props = {
  fontFamily: tally(),
  fontSize: tally(),
  radius: tally(),
  shadow: tally(),
  transition: tally(),
};
const varDefs = new Map(); // token name -> { value, file }
const varUses = tally();

for (const [file, text] of allSources) {
  scan(text, RE.cssVarDef, (m) => {
    const value = m[2].trim();
    if (!varDefs.has(m[1]))
      varDefs.set(m[1], {
        value,
        file: rel(file),
        line: lineAt(text, m.index),
      });
  });
}

for (const [file, text] of sources) {
  const ext = extname(file);
  const isStyle = STYLE_EXT.has(ext);

  scan(text, RE.cssVarUse, (m) =>
    bump(varUses, m[1], file, lineAt(text, m.index)),
  );

  scan(text, RE.hex, (m) =>
    bump(colors, m[0].toLowerCase(), file, lineAt(text, m.index)),
  );
  scan(text, RE.fn, (m) =>
    bump(colors, m[0].replace(/\s+/g, ' '), file, lineAt(text, m.index)),
  );

  if (isStyle) {
    scan(text, RE.size, (m) => bump(sizes, m[0], file, lineAt(text, m.index)));
    for (const name of Object.keys(props))
      scan(text, RE[name], (m) =>
        bump(
          props[name],
          m[1].trim().replace(/\s+/g, ' '),
          file,
          lineAt(text, m.index),
        ),
      );
  }
}

/* ------------------------------------------------------- class strings */

const classStrings = tally(); // whole normalized attribute value
const classTokens = tally(); // individual utility

const normalizeClasses = (raw) =>
  raw
    .replace(/\$\{[^}]*\}/g, ' ') // template interpolation
    .split(/\s+/)
    .filter(Boolean)
    .sort();

for (const [file, text] of sources) {
  if (!MARKUP_EXT.has(extname(file)) && !CODE_EXT.has(extname(file))) continue;
  scan(text, RE.classAttr, (m) => {
    const raw = m[1] ?? m[2] ?? m[3] ?? '';
    const parts = normalizeClasses(raw);
    if (parts.length < 2) return;
    const line = lineAt(text, m.index);
    bump(classStrings, parts.join(' '), file, line);
    for (const t of parts) {
      bump(classTokens, t, file, line);
      RE.arbitrary.lastIndex = 0;
      if (RE.arbitrary.test(t)) bump(arbitrary, t, file, line);
    }
  });
}

/* ------------------------------------------ token defined but bypassed */

const bypassed = [];
for (const [name, def] of varDefs) {
  const literal = def.value.trim().toLowerCase();
  if (!/^(#[0-9a-f]{3,8}|(rgba?|hsla?|oklch|oklab)\(|\d)/.test(literal))
    continue;
  const hits = colors.get(literal) ?? sizes.get(literal);
  if (!hits) continue;
  const elsewhere = hits.sites.filter((s) => !s.startsWith(def.file));
  if (elsewhere.length) {
    bypassed.push({
      token: name,
      value: def.value.trim(),
      definedIn: `${def.file}:${def.line}`,
      usesOfToken: varUses.get(name)?.count ?? 0,
      literalUses: hits.count,
      sites: elsewhere.slice(0, 10),
    });
  }
}
bypassed.sort((a, b) => b.literalUses - a.literalUses);

/* ------------------------------------------ near-duplicate candidates */

const STRUCT =
  /<\/?([A-Za-z][\w.-]*)|(?:className|class)\s*=\s*(?:"([^"]{0,400})"|'([^']{0,400})')/g;

function sequence(text) {
  const seq = [];
  scan(text, STRUCT, (m) => {
    if (m[1])
      seq.push({
        t: m[0].startsWith('</') ? `</${m[1]}` : `<${m[1]}`,
        i: m.index,
      });
    else {
      const parts = normalizeClasses(m[2] ?? m[3] ?? '');
      if (parts.length) seq.push({ t: `.${parts.join('.')}`, i: m.index });
    }
  });
  return seq;
}

const djb2 = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

const shingles = new Map();
for (const [file, text] of sources) {
  if (!MARKUP_EXT.has(extname(file))) continue;
  const seq = sequence(text);
  for (let i = 0; i + K <= seq.length; i++) {
    const window = seq.slice(i, i + K);
    const h = djb2(window.map((w) => w.t).join('|'));
    let e = shingles.get(h);
    if (!e)
      shingles.set(
        h,
        (e = { preview: window.map((w) => w.t).join(' '), sites: [] }),
      );
    e.sites.push({ file: rel(file), line: lineAt(text, window[0].i) });
  }
}

const seenPair = new Set();
const duplicates = [];
for (const e of shingles.values()) {
  const byFile = new Map();
  for (const s of e.sites) if (!byFile.has(s.file)) byFile.set(s.file, s.line);
  if (byFile.size < 2 && e.sites.length < 2) continue;
  const fingerprint = [...byFile.keys()].sort().join('|');
  if (seenPair.has(fingerprint)) continue;
  seenPair.add(fingerprint);
  duplicates.push({
    occurrences: e.sites.length,
    files: byFile.size,
    sites: [...byFile].map(([f, l]) => `${f}:${l}`).slice(0, 10),
    preview: e.preview.length > 220 ? `${e.preview.slice(0, 220)}…` : e.preview,
  });
}
duplicates.sort((a, b) => b.files - a.files || b.occurrences - a.occurrences);

/* ---------------------------------------------------------------- report */

const result = {
  root: ROOT,
  flavor: FLAVOR,
  filesScanned: files.length,
  tokensDefined: varDefs.size,
  tokenBypasses: bypassed.slice(0, TOP),
  colors: rank(colors, 1)
    .slice(0, TOP)
    .map((e) => ({
      value: e.key,
      count: e.count,
      files: distinctFiles(e),
      sites: e.sites,
    })),
  sizes: rank(sizes, 2)
    .slice(0, TOP)
    .map((e) => ({ value: e.key, count: e.count, sites: e.sites })),
  arbitraryValues: rank(arbitrary, 1)
    .slice(0, TOP)
    .map((e) => ({ value: e.key, count: e.count, sites: e.sites })),
  properties: Object.fromEntries(
    Object.entries(props).map(([k, m]) => [
      k,
      rank(m, 1)
        .slice(0, 12)
        .map((e) => ({ value: e.key, count: e.count, sites: e.sites })),
    ]),
  ),
  repeatedClassStrings: rank(classStrings, 2)
    .slice(0, TOP)
    .map((e) => ({
      classes: e.key,
      count: e.count,
      files: distinctFiles(e),
      sites: e.sites,
    })),
  utilityFrequency: rank(classTokens, 1)
    .slice(0, TOP * 2)
    .map((e) => ({ token: e.key, count: e.count })),
  duplicateCandidates: duplicates.slice(0, TOP),
};

if (has('json')) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  const out = [];
  const section = (title, rows) => {
    out.push(`\n## ${title}`);
    if (!rows.length) out.push('  (none)');
    else out.push(...rows.map((r) => `  ${r}`));
  };
  out.push(`# UI census — ${ROOT}`);
  out.push(
    `flavor: ${FLAVOR}   files: ${files.length}   tokens defined: ${varDefs.size}`,
  );
  section(
    'Tokens defined but bypassed by a raw literal',
    result.tokenBypasses.map(
      (b) =>
        `${b.token} = ${b.value} (${b.usesOfToken}× via var, ${b.literalUses}× as literal) → ${b.sites.join(', ')}`,
    ),
  );
  section(
    'Color literals',
    result.colors.map(
      (c) =>
        `${c.value}  ${c.count}× in ${c.files} files  → ${c.sites.slice(0, 4).join(', ')}`,
    ),
  );
  section(
    'Arbitrary / escape-hatch values',
    result.arbitraryValues.map(
      (a) => `${a.value}  ${a.count}×  → ${a.sites.slice(0, 4).join(', ')}`,
    ),
  );
  for (const [name, rows] of Object.entries(result.properties))
    section(
      `Declared ${name} values`,
      rows.map(
        (r) => `${r.value}  ${r.count}×  → ${r.sites.slice(0, 3).join(', ')}`,
      ),
    );
  section(
    'Repeated class strings',
    result.repeatedClassStrings.map(
      (c) =>
        `${c.count}× in ${c.files} files → ${c.sites.slice(0, 4).join(', ')}\n     ${c.classes}`,
    ),
  );
  section(
    'Near-duplicate markup CANDIDATES (unverified — read the files before reporting)',
    result.duplicateCandidates.map(
      (d) =>
        `${d.occurrences}× across ${d.files} files → ${d.sites.join(', ')}\n     ${d.preview}`,
    ),
  );
  process.stdout.write(`${out.join('\n')}\n`);
}
