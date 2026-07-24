/**
 * Workflow prompt template parser + substitution — pure, isomorphic, unit-tested.
 *
 * The prompt is the single source of truth: input fields are parsed out of the
 * inline `{{ ... }}` placeholder grammar (§5 of the workflows design), never
 * stored separately. The same module runs client-side (live builder preview,
 * fill-form) and server-side (authoritative validation before substitution).
 *
 * No DOM / network / LLM — the same pure-module exception as the stream reducer
 * and widget envelope. Covered by template.test.ts.
 */

export type FieldType = 'text' | 'longtext' | 'select' | 'multi';

export interface FieldDef {
  name: string;
  label: string; // custom `label=` or humanized `name`
  type: FieldType;
  required: boolean;
  description?: string; // custom `desc=`, rendered as helper text
  options?: string[]; // select | multi
  default?: string | string[];
}

export interface ParseError {
  message: string;
  index: number; // index into prompt where the offending token/line starts
}

export interface ParseResult {
  fields: FieldDef[];
  errors: ParseError[];
  warnings: ParseError[];
}

const FIELD_TYPES: readonly FieldType[] = [
  'text',
  'longtext',
  'select',
  'multi',
];
const OFFSET_UNITS = new Set(['d', 'w', 'm', 'y', 'h', 'min']);
const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const RESERVED_NAME_RE = /^step\d*_output$/i;

interface RawToken {
  raw: string; // inner content, trimmed
  start: number; // index of the opening `{{` in the prompt
}

/**
 * Scan the prompt for `{{ ... }}` tokens, honoring `\{{` / `\}}` escapes for
 * literal braces. Returns tokens in order, plus any unclosed-token error.
 */
function scanTokens(prompt: string): {
  tokens: RawToken[];
  unclosed: ParseError | null;
} {
  const tokens: RawToken[] = [];
  let i = 0;
  while (i < prompt.length) {
    // Escaped literal braces are not token boundaries.
    if (prompt[i] === '\\' && prompt.startsWith('{{', i + 1)) {
      i += 3;
      continue;
    }
    if (prompt.startsWith('{{', i)) {
      const start = i;
      const close = prompt.indexOf('}}', i + 2);
      if (close === -1) {
        return {
          tokens,
          unclosed: { message: 'Unclosed placeholder ({{ … }})', index: start },
        };
      }
      tokens.push({ raw: prompt.slice(i + 2, close).trim(), start });
      i = close + 2;
      continue;
    }
    i += 1;
  }
  return { tokens, unclosed: null };
}

/** Split `s` on top-level (unquoted) occurrences of `sep` (single char). */
function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let buf = '';
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      inQuote = !inQuote;
      buf += c;
    } else if (c === sep && !inQuote) {
      out.push(buf);
      buf = '';
    } else {
      buf += c;
    }
  }
  out.push(buf);
  return out;
}

function unquote(v: string): string {
  const t = v.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1);
  }
  return t;
}

export function humanize(name: string): string {
  return name
    .split('_')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** True for a reserved built-in token (`@today` / `@now` family, §5.2). */
export function isBuiltinToken(raw: string): boolean {
  return raw.startsWith('@');
}

interface BuiltinSpec {
  base: 'today' | 'now';
  offsetSign: 1 | -1;
  offsetAmount: number;
  offsetUnit: string | null;
  format: string | null;
}

function parseBuiltin(raw: string): BuiltinSpec | { error: string } {
  // @today | @now, optional ±<n><unit>, optional :format
  const m = /^@(today|now)/.exec(raw);
  if (!m) return { error: `Unknown built-in token: ${raw}` };
  let rest = raw.slice(m[0].length);
  const spec: BuiltinSpec = {
    base: m[1] as 'today' | 'now',
    offsetSign: 1,
    offsetAmount: 0,
    offsetUnit: null,
    format: null,
  };

  const off = /^([+-])(\d+)([A-Za-z]+)/.exec(rest);
  if (off) {
    if (!OFFSET_UNITS.has(off[3])) {
      return { error: `Unknown offset unit: ${off[3]}` };
    }
    spec.offsetSign = off[1] === '-' ? -1 : 1;
    spec.offsetAmount = parseInt(off[2], 10);
    spec.offsetUnit = off[3];
    rest = rest.slice(off[0].length);
  }

  if (rest.startsWith(':')) {
    spec.format = rest.slice(1).trim();
    rest = '';
  }

  if (rest.trim().length > 0) {
    return { error: `Malformed built-in token: ${raw}` };
  }
  return spec;
}

/**
 * Split an optional leading YAML-style frontmatter block off the prompt. Only a
 * fence whose very first line is `---` counts; `---` elsewhere stays a markdown
 * rule. Returns `bodyOffset` so body token indices map back to absolute prompt
 * positions for editor highlighting.
 */
export function splitFrontmatter(prompt: string): {
  frontmatter: string | null;
  frontmatterOffset: number;
  body: string;
  bodyOffset: number;
} {
  const none = {
    frontmatter: null,
    frontmatterOffset: 0,
    body: prompt,
    bodyOffset: 0,
  };
  const open = /^---[ \t]*\r?\n/.exec(prompt);
  if (!open) return none;
  const rest = prompt.slice(open[0].length);
  const close = /^---[ \t]*(\r?\n|$)/m.exec(rest);
  if (!close) return none;
  const frontmatter = rest.slice(0, close.index);
  const bodyOffset = open[0].length + close.index + close[0].length;
  return {
    frontmatter,
    frontmatterOffset: open[0].length,
    body: prompt.slice(bodyOffset),
    bodyOffset,
  };
}

/** Parse a single frontmatter line (`name: <type?> | attr | attr…`). */
function parseFieldLine(
  line: string,
  index: number,
): { field?: FieldDef; error?: ParseError } {
  const err = (message: string) => ({ error: { message, index } });

  const colon = line.indexOf(':');
  if (colon === -1) return err(`Field line needs a name and colon: "${line}"`);
  const name = line.slice(0, colon).trim();
  if (!NAME_RE.test(name)) return err(`Invalid field name: "${name}"`);
  if (RESERVED_NAME_RE.test(name)) return err(`Reserved field name: "${name}"`);

  const segs = splitTopLevel(line.slice(colon + 1), '|').map((s) => s.trim());
  const typeStr = segs[0];
  let type: FieldType = 'text';
  if (typeStr.length > 0) {
    if (!FIELD_TYPES.includes(typeStr as FieldType)) {
      return err(`Unknown field type: "${typeStr}"`);
    }
    type = typeStr as FieldType;
  }

  let required = true;
  let label: string | undefined;
  let description: string | undefined;
  let options: string[] | undefined;
  let defaultRaw: string | null = null;

  for (const seg of segs.slice(1)) {
    if (seg.length === 0) continue;
    if (seg === 'optional') {
      required = false;
      continue;
    }
    const eq = seg.indexOf('=');
    if (eq === -1) return err(`Unknown attribute: "${seg}"`);
    const key = seg.slice(0, eq).trim();
    const value = seg.slice(eq + 1).trim();
    switch (key) {
      case 'label':
        label = unquote(value);
        break;
      case 'desc':
        description = unquote(value);
        break;
      case 'options':
        options = splitTopLevel(value, ',')
          .map((o) => unquote(o))
          .filter((o) => o.length > 0);
        break;
      case 'default':
        defaultRaw = value;
        break;
      default:
        return err(`Unknown attribute: "${key}"`);
    }
  }

  if (type !== 'select' && type !== 'multi') {
    if (options)
      return err(`Options are only valid for select/multi: "${name}"`);
  } else if (!options || options.length === 0) {
    return err(`${type} "${name}" needs at least one option`);
  }

  let def: string | string[] | undefined;
  if (defaultRaw !== null && defaultRaw.length > 0) {
    if (type === 'multi') {
      const vals = splitTopLevel(defaultRaw, ',')
        .map((v) => unquote(v))
        .filter((v) => v.length > 0);
      for (const v of vals) {
        if (!options!.includes(v)) {
          return err(`Default "${v}" is not among the options for "${name}"`);
        }
      }
      def = vals;
    } else {
      const v = unquote(defaultRaw);
      if (type === 'select' && !options!.includes(v)) {
        return err(`Default "${v}" is not among the options for "${name}"`);
      }
      def = v;
    }
  }

  return {
    field: {
      name,
      label: label ?? humanize(name),
      type,
      required,
      ...(description && { description }),
      ...(options && { options }),
      ...(def !== undefined && { default: def }),
    },
  };
}

/** Parse the frontmatter block into field defs, tracking absolute line offsets. */
function parseFrontmatter(
  frontmatter: string,
  baseOffset: number,
): { fields: FieldDef[]; errors: ParseError[] } {
  const fields: FieldDef[] = [];
  const errors: ParseError[] = [];
  const seen = new Set<string>();
  let offset = baseOffset;
  for (const rawLine of frontmatter.split('\n')) {
    const line = rawLine.trim();
    if (line.length === 0) {
      offset += rawLine.length + 1;
      continue;
    }
    const { field, error } = parseFieldLine(line, offset);
    if (error) errors.push(error);
    else if (field) {
      if (seen.has(field.name)) {
        errors.push({
          message: `Duplicate field name: "${field.name}"`,
          index: offset,
        });
      } else {
        seen.add(field.name);
        fields.push(field);
      }
    }
    offset += rawLine.length + 1;
  }
  return { fields, errors };
}

export function parseWorkflowTemplate(prompt: string): ParseResult {
  const { frontmatter, frontmatterOffset, body, bodyOffset } =
    splitFrontmatter(prompt);
  const { fields, errors } =
    frontmatter !== null
      ? parseFrontmatter(frontmatter, frontmatterOffset)
      : { fields: [] as FieldDef[], errors: [] as ParseError[] };
  const warnings: ParseError[] = [];
  const byName = new Map(fields.map((f) => [f.name, f]));
  const referenced = new Set<string>();

  const { tokens, unclosed } = scanTokens(body);
  for (const tok of tokens) {
    const at = tok.start + bodyOffset;
    if (isBuiltinToken(tok.raw)) {
      const b = parseBuiltin(tok.raw);
      if ('error' in b) errors.push({ message: b.error, index: at });
      continue;
    }
    if (!NAME_RE.test(tok.raw)) {
      errors.push({
        message: `Invalid placeholder: {{${tok.raw}}}`,
        index: at,
      });
      continue;
    }
    if (!byName.has(tok.raw)) {
      errors.push({ message: `Undefined input: {{${tok.raw}}}`, index: at });
      continue;
    }
    referenced.add(tok.raw);
  }

  if (unclosed) {
    errors.push({
      message: unclosed.message,
      index: unclosed.index + bodyOffset,
    });
  }

  for (const f of fields) {
    if (!referenced.has(f.name)) {
      warnings.push({
        message: `Field "${f.name}" is defined but never referenced`,
        index: 0,
      });
    }
  }

  return { fields, errors, warnings };
}

/** Field names that are required but have no usable value in `values`. */
export function missingRequired(
  fields: FieldDef[],
  values: Record<string, string | string[]>,
): string[] {
  const missing: string[] = [];
  for (const f of fields) {
    if (!f.required) continue;
    if (!isEmptyValue(resolveValue(f, values))) continue;
    if (f.default !== undefined && !isEmptyValue(f.default)) continue;
    missing.push(f.name);
  }
  return missing;
}

/**
 * Field names whose provided `select`/`multi` value isn't among the field's
 * declared options — the fill-set counterpart to §5's "must be among declared
 * options" rule the parser already enforces for defaults. Empty values are the
 * concern of `missingRequired`, not this check.
 */
export function invalidValues(
  fields: FieldDef[],
  values: Record<string, string | string[]>,
): string[] {
  const invalid: string[] = [];
  for (const f of fields) {
    if (f.type !== 'select' && f.type !== 'multi') continue;
    const options = f.options ?? [];
    const raw = values[f.name];
    if (raw === undefined || raw === null) continue;
    const provided = (Array.isArray(raw) ? raw : [raw]).filter(
      (v) => v.trim().length > 0,
    );
    if (provided.some((v) => !options.includes(v))) invalid.push(f.name);
  }
  return invalid;
}

/** Combined fill-set gate: required-but-empty plus out-of-options values. */
export function fillSetErrors(
  fields: FieldDef[],
  values: Record<string, string | string[]>,
): string[] {
  return [...missingRequired(fields, values), ...invalidValues(fields, values)];
}

function resolveValue(
  f: FieldDef,
  values: Record<string, string | string[]>,
): string | string[] | undefined {
  const v = values[f.name];
  if (isEmptyValue(v) && f.default !== undefined) return f.default;
  return v;
}

function isEmptyValue(v: string | string[] | undefined): boolean {
  if (v === undefined || v === null) return true;
  if (Array.isArray(v)) return v.length === 0;
  return v.trim().length === 0;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function applyOffset(base: Date, spec: BuiltinSpec): Date {
  const d = new Date(base.getTime());
  const n = spec.offsetSign * spec.offsetAmount;
  switch (spec.offsetUnit) {
    case 'd':
      d.setDate(d.getDate() + n);
      break;
    case 'w':
      d.setDate(d.getDate() + n * 7);
      break;
    case 'm':
      d.setMonth(d.getMonth() + n);
      break;
    case 'y':
      d.setFullYear(d.getFullYear() + n);
      break;
    case 'h':
      d.setHours(d.getHours() + n);
      break;
    case 'min':
      d.setMinutes(d.getMinutes() + n);
      break;
  }
  return d;
}

function formatBuiltin(spec: BuiltinSpec, now: Date): string {
  const d = applyOffset(now, spec);
  const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  switch (spec.format) {
    case 'long':
      return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    case 'short':
      return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
    case null:
    case undefined:
    case '':
      return spec.base === 'now'
        ? `${iso} ${pad(d.getHours())}:${pad(d.getMinutes())}`
        : iso;
    default:
      // Unknown format falls back to ISO; parse-time already flags it as an error.
      return spec.base === 'now'
        ? `${iso} ${pad(d.getHours())}:${pad(d.getMinutes())}`
        : iso;
  }
}

function fieldValueToString(
  f: FieldDef,
  v: string | string[] | undefined,
): string {
  if (v === undefined) return '';
  if (f.type === 'multi') {
    const arr = Array.isArray(v) ? v : v ? [v] : [];
    return arr.join(', ');
  }
  return Array.isArray(v) ? v.join(', ') : v;
}

/**
 * Substitute placeholders in `prompt`. Pure and deterministic given `now`
 * (the run clock — scheduled runs pass fire time, manual runs request time).
 * Missing/empty values fall back to a field's declared default; built-in
 * date/time tokens are computed from `now`.
 */
export function substitute(
  prompt: string,
  fields: FieldDef[],
  values: Record<string, string | string[]>,
  now: Date,
): string {
  const byName = new Map(fields.map((f) => [f.name, f]));
  // Frontmatter is field definitions, not output — substitute only the body.
  const { body } = splitFrontmatter(prompt);
  let out = '';
  let i = 0;
  while (i < body.length) {
    if (body[i] === '\\' && body.startsWith('{{', i + 1)) {
      out += '{{';
      i += 3;
      continue;
    }
    if (body[i] === '\\' && body.startsWith('}}', i + 1)) {
      out += '}}';
      i += 3;
      continue;
    }
    if (body.startsWith('{{', i)) {
      const close = body.indexOf('}}', i + 2);
      if (close === -1) {
        out += body.slice(i);
        break;
      }
      const raw = body.slice(i + 2, close).trim();
      if (isBuiltinToken(raw)) {
        const b = parseBuiltin(raw);
        out += 'error' in b ? '' : formatBuiltin(b, now);
      } else {
        // Body refs are bare `{{name}}`; unknown tokens are dropped (parse-time
        // already blocks such prompts).
        const f = byName.get(raw);
        if (f) out += fieldValueToString(f, resolveValue(f, values));
      }
      i = close + 2;
      continue;
    }
    out += body[i];
    i += 1;
  }
  return out;
}
