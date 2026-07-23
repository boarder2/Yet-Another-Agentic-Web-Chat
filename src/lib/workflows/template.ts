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
  label: string; // derived by humanizing `name`
  type: FieldType;
  required: boolean;
  options?: string[]; // select | multi
  default?: string | string[];
}

export interface ParseError {
  message: string;
  index: number; // index into prompt where the offending token starts
}

export interface ParseResult {
  fields: FieldDef[];
  errors: ParseError[];
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

/** Index of the first top-level (unquoted) occurrence of `ch`, or -1. */
function indexOfTopLevel(s: string, ch: string): number {
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"') inQuote = !inQuote;
    else if (s[i] === ch && !inQuote) return i;
  }
  return -1;
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

/** Parse a single non-builtin token's inner content into a FieldDef. */
function parseField(
  raw: string,
  index: number,
): { field?: FieldDef; error?: ParseError } {
  const err = (message: string) => ({ error: { message, index } });

  // name (+ optional `?` optional marker)
  const nameMatch = /^([^\s:=?]+)\s*(\??)/.exec(raw);
  if (!nameMatch) return err(`Malformed placeholder: {{${raw}}}`);
  const name = nameMatch[1];
  const required = nameMatch[2] !== '?';

  if (!NAME_RE.test(name)) return err(`Invalid placeholder name: "${name}"`);
  if (RESERVED_NAME_RE.test(name)) {
    return err(`Reserved placeholder name: "${name}"`);
  }

  let rest = raw.slice(nameMatch[0].length).trim();

  // Optional default: everything after the first top-level `=`.
  let defaultRaw: string | null = null;
  const eq = indexOfTopLevel(rest, '=');
  if (eq !== -1) {
    defaultRaw = rest.slice(eq + 1).trim();
    rest = rest.slice(0, eq).trim();
  }

  let type: FieldType = 'text';
  let options: string[] | undefined;

  if (rest.length > 0) {
    // rest must start with `:type` (optionally followed by `:options`).
    if (!rest.startsWith(':')) {
      return err(`Malformed placeholder: {{${raw}}}`);
    }
    const segs = splitTopLevel(rest.slice(1), ':').map((s) => s.trim());
    const typeStr = segs[0];
    if (!FIELD_TYPES.includes(typeStr as FieldType)) {
      return err(`Unknown field type: "${typeStr}"`);
    }
    type = typeStr as FieldType;

    if (segs.length > 2) return err(`Malformed placeholder: {{${raw}}}`);
    if (segs.length === 2) {
      if (type !== 'select' && type !== 'multi') {
        return err(`Options are only valid for select/multi: "${name}"`);
      }
      options = splitTopLevel(segs[1], '|')
        .map((o) => unquote(o))
        .filter((o) => o.length > 0);
    }
  }

  if (type === 'select' || type === 'multi') {
    if (!options || options.length === 0) {
      return err(`${type} "${name}" needs at least one option`);
    }
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
      label: humanize(name),
      type,
      required,
      ...(options && { options }),
      ...(def !== undefined && { default: def }),
    },
  };
}

export function parseWorkflowTemplate(prompt: string): ParseResult {
  const { tokens, unclosed } = scanTokens(prompt);
  const errors: ParseError[] = [];
  const fields: FieldDef[] = [];
  const seen = new Set<string>();

  for (const tok of tokens) {
    if (isBuiltinToken(tok.raw)) {
      const b = parseBuiltin(tok.raw);
      if ('error' in b) errors.push({ message: b.error, index: tok.start });
      continue;
    }
    const { field, error } = parseField(tok.raw, tok.start);
    if (error) {
      errors.push(error);
      continue;
    }
    if (field) {
      if (seen.has(field.name)) {
        errors.push({
          message: `Duplicate placeholder name: "${field.name}"`,
          index: tok.start,
        });
        continue;
      }
      seen.add(field.name);
      fields.push(field);
    }
  }

  if (unclosed) errors.push(unclosed);
  return { fields, errors };
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
  let out = '';
  let i = 0;
  while (i < prompt.length) {
    if (prompt[i] === '\\' && prompt.startsWith('{{', i + 1)) {
      out += '{{';
      i += 3;
      continue;
    }
    if (prompt[i] === '\\' && prompt.startsWith('}}', i + 1)) {
      out += '}}';
      i += 3;
      continue;
    }
    if (prompt.startsWith('{{', i)) {
      const close = prompt.indexOf('}}', i + 2);
      if (close === -1) {
        out += prompt.slice(i);
        break;
      }
      const raw = prompt.slice(i + 2, close).trim();
      if (isBuiltinToken(raw)) {
        const b = parseBuiltin(raw);
        out += 'error' in b ? '' : formatBuiltin(b, now);
      } else {
        const nameMatch = /^([^\s:=?]+)/.exec(raw);
        const f = nameMatch ? byName.get(nameMatch[1]) : undefined;
        if (f) {
          out += fieldValueToString(f, resolveValue(f, values));
        }
        // Unknown field token: drop it (parse-time already flags such prompts).
      }
      i = close + 2;
      continue;
    }
    out += prompt[i];
    i += 1;
  }
  return out;
}
