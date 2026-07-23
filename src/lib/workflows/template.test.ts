import { describe, it, expect } from 'vitest';
import {
  parseWorkflowTemplate,
  substitute,
  missingRequired,
  invalidValues,
  fillSetErrors,
  humanize,
  type FieldDef,
} from './template';

const parse = (p: string) => parseWorkflowTemplate(p);
const fields = (p: string) => parse(p).fields;

describe('parseWorkflowTemplate — grammar', () => {
  it('parses a bare required text field with a humanized label', () => {
    expect(fields('Hello {{company}}')).toEqual([
      { name: 'company', label: 'Company', type: 'text', required: true },
    ]);
  });

  it('humanizes multi-word names', () => {
    expect(humanize('launch_date')).toBe('Launch Date');
    expect(fields('{{launch_date}}')[0].label).toBe('Launch Date');
  });

  it('treats a trailing `?` as optional', () => {
    expect(fields('{{notes?:longtext}}')).toEqual([
      { name: 'notes', label: 'Notes', type: 'longtext', required: false },
    ]);
  });

  it('parses select with options and a default', () => {
    expect(
      fields('{{tone:select: Formal | Casual | Technical = Formal}}'),
    ).toEqual([
      {
        name: 'tone',
        label: 'Tone',
        type: 'select',
        required: true,
        options: ['Formal', 'Casual', 'Technical'],
        default: 'Formal',
      },
    ]);
  });

  it('parses multi with a comma-separated default subset', () => {
    expect(
      fields(
        '{{areas:multi: Security | Performance | Cost = Security, Performance}}',
      ),
    ).toEqual([
      {
        name: 'areas',
        label: 'Areas',
        type: 'multi',
        required: true,
        options: ['Security', 'Performance', 'Cost'],
        default: ['Security', 'Performance'],
      },
    ]);
  });

  it('parses a text field with a default and no type', () => {
    expect(fields('{{company = Acme}}')).toEqual([
      {
        name: 'company',
        label: 'Company',
        type: 'text',
        required: true,
        default: 'Acme',
      },
    ]);
  });

  it('supports quoted option values containing delimiters', () => {
    const f = fields('{{x:select: "a:b" | "c=d" }}')[0];
    expect(f.options).toEqual(['a:b', 'c=d']);
  });

  it('collects multiple fields in order', () => {
    expect(fields('{{a}} {{b?:longtext}}').map((f) => f.name)).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('parseWorkflowTemplate — errors', () => {
  const errs = (p: string) => parse(p).errors;

  it('flags an unclosed token', () => {
    expect(errs('hi {{company')).toHaveLength(1);
    expect(errs('hi {{company')[0].index).toBe(3);
  });

  it('flags an unknown type', () => {
    expect(errs('{{x:number}}')).toHaveLength(1);
  });

  it('flags a duplicate name', () => {
    const e = errs('{{a}} {{a}}');
    expect(e).toHaveLength(1);
    expect(e[0].message).toMatch(/duplicate/i);
  });

  it('flags select/multi with zero options', () => {
    expect(errs('{{x:select}}')).toHaveLength(1);
    expect(errs('{{x:multi}}')).toHaveLength(1);
  });

  it('flags a default not among options', () => {
    expect(errs('{{t:select: A | B = C}}')).toHaveLength(1);
    expect(errs('{{t:multi: A | B = A, C}}')).toHaveLength(1);
  });

  it('flags a reserved built-in name for user input', () => {
    // `@`-prefixed is a built-in, not a user field — a bad one errors.
    expect(errs('{{@foo}}')).toHaveLength(1);
  });

  it('flags the reserved step*_output prefix', () => {
    expect(errs('{{step1_output}}')).toHaveLength(1);
  });

  it('flags options on a non-select type', () => {
    expect(errs('{{x:text: A | B}}')).toHaveLength(1);
  });

  it('flags an invalid name', () => {
    expect(errs('{{1bad}}')).toHaveLength(1);
  });
});

describe('parseWorkflowTemplate — built-in date/time tokens', () => {
  it('excludes @today/@now from fields', () => {
    expect(fields('from {{@today-30d}} to {{@today}}')).toEqual([]);
    expect(parse('at {{@now}}').errors).toEqual([]);
  });

  it('accepts valid offsets and formats', () => {
    expect(parse('{{@today-30d}} {{@now+2h}} {{@today:long}}').errors).toEqual(
      [],
    );
  });

  it('flags an unknown built-in', () => {
    expect(parse('{{@foo}}').errors).toHaveLength(1);
  });

  it('flags a bad offset unit', () => {
    expect(parse('{{@today+5x}}').errors).toHaveLength(1);
  });
});

describe('substitute', () => {
  const clock = new Date('2026-07-22T14:30:00Z');
  const at = (p: string, values: Record<string, string | string[]> = {}) =>
    substitute(p, fields(p), values, clock);

  it('substitutes single-value types with the raw value', () => {
    expect(at('Hi {{company}}', { company: 'Acme' })).toBe('Hi Acme');
  });

  it('joins multi values with ", "', () => {
    expect(at('{{areas:multi: A | B | C}}', { areas: ['A', 'C'] })).toBe(
      'A, C',
    );
  });

  it('renders optional empty as an empty string', () => {
    expect(at('[{{notes?}}]', {})).toBe('[]');
  });

  it('falls back to a declared default when the value is empty', () => {
    expect(at('{{tone:select: Formal | Casual = Formal}}', {})).toBe('Formal');
  });

  it('unescapes literal braces', () => {
    expect(substitute('\\{{ raw \\}}', [], {}, clock)).toBe('{{ raw }}');
  });

  it('computes @today with an offset, ISO by default', () => {
    // Use a fixed local clock; only assert the date component shape.
    const out = substitute('{{@today}}', [], {}, new Date(2026, 6, 22, 9, 0));
    expect(out).toBe('2026-07-22');
    const past = substitute('{{@today-30d}}', [], {}, new Date(2026, 6, 22));
    expect(past).toBe('2026-06-22');
  });

  it('computes @today:long', () => {
    expect(substitute('{{@today:long}}', [], {}, new Date(2026, 6, 22))).toBe(
      'July 22, 2026',
    );
  });

  it('is deterministic given a fixed clock', () => {
    const p = 'sales {{@today-1w}}';
    const a = substitute(p, [], {}, new Date(2026, 6, 22));
    const b = substitute(p, [], {}, new Date(2026, 6, 22));
    expect(a).toBe(b);
    expect(a).toBe('sales 2026-07-15');
  });
});

describe('missingRequired', () => {
  const fs: FieldDef[] = [
    { name: 'a', label: 'A', type: 'text', required: true },
    { name: 'b', label: 'B', type: 'text', required: false },
    { name: 'c', label: 'C', type: 'text', required: true, default: 'x' },
  ];

  it('reports required fields with no value and no default', () => {
    expect(missingRequired(fs, {})).toEqual(['a']);
  });

  it('is satisfied when a value is supplied', () => {
    expect(missingRequired(fs, { a: 'y' })).toEqual([]);
  });

  it('treats an empty multi array as missing', () => {
    const mf: FieldDef[] = [
      { name: 'm', label: 'M', type: 'multi', required: true, options: ['A'] },
    ];
    expect(missingRequired(mf, { m: [] })).toEqual(['m']);
  });
});

describe('invalidValues', () => {
  const sel: FieldDef[] = [
    {
      name: 's',
      label: 'S',
      type: 'select',
      required: false,
      options: ['A', 'B'],
    },
    {
      name: 'm',
      label: 'M',
      type: 'multi',
      required: false,
      options: ['X', 'Y'],
    },
    { name: 't', label: 'T', type: 'text', required: false },
  ];

  it('flags a select value not among options', () => {
    expect(invalidValues(sel, { s: 'C' })).toEqual(['s']);
  });

  it('flags a multi containing an out-of-options value', () => {
    expect(invalidValues(sel, { m: ['X', 'Z'] })).toEqual(['m']);
  });

  it('accepts in-options values and ignores empty/text fields', () => {
    expect(invalidValues(sel, { s: 'A', m: ['Y'], t: 'anything' })).toEqual([]);
    expect(invalidValues(sel, { s: '', m: [] })).toEqual([]);
  });

  it('fillSetErrors combines required-empty and out-of-options', () => {
    const fs: FieldDef[] = [
      { name: 'a', label: 'A', type: 'text', required: true },
      {
        name: 's',
        label: 'S',
        type: 'select',
        required: false,
        options: ['A'],
      },
    ];
    expect(fillSetErrors(fs, { s: 'nope' })).toEqual(['a', 's']);
  });
});
