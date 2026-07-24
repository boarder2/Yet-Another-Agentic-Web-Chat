import { describe, it, expect } from 'vitest';
import {
  parseWorkflowTemplate,
  splitFrontmatter,
  substitute,
  missingRequired,
  invalidValues,
  fillSetErrors,
  humanize,
  type FieldDef,
} from './template';

const parse = (p: string) => parseWorkflowTemplate(p);
const fields = (p: string) => parse(p).fields;
const fm = (lines: string, body: string) => `---\n${lines}\n---\n${body}`;

describe('splitFrontmatter', () => {
  it('splits a leading fence and offsets the body', () => {
    const r = splitFrontmatter('---\ntopic:\n---\nHi {{topic}}');
    expect(r.frontmatter).toBe('topic:\n');
    expect(r.body).toBe('Hi {{topic}}');
    expect('---\ntopic:\n---\nHi {{topic}}'.slice(r.bodyOffset)).toBe(
      'Hi {{topic}}',
    );
  });

  it('treats a prompt with no leading fence as all body', () => {
    const r = splitFrontmatter('No frontmatter {{here}}');
    expect(r.frontmatter).toBeNull();
    expect(r.body).toBe('No frontmatter {{here}}');
    expect(r.bodyOffset).toBe(0);
  });

  it('leaves a `---` that is not the first line as body (markdown rule)', () => {
    const r = splitFrontmatter('Intro\n---\nRest');
    expect(r.frontmatter).toBeNull();
    expect(r.body).toBe('Intro\n---\nRest');
  });
});

describe('parseWorkflowTemplate — grammar', () => {
  it('parses a bare required text field with a humanized label', () => {
    expect(fields(fm('company:', 'Hello {{company}}'))).toEqual([
      { name: 'company', label: 'Company', type: 'text', required: true },
    ]);
  });

  it('humanizes multi-word names', () => {
    expect(humanize('launch_date')).toBe('Launch Date');
    expect(fields(fm('launch_date:', '{{launch_date}}'))[0].label).toBe(
      'Launch Date',
    );
  });

  it('defaults the type to text when the type segment is empty', () => {
    expect(fields(fm('topic:', '{{topic}}'))[0].type).toBe('text');
  });

  it('treats a bare `optional` attribute as not required', () => {
    expect(fields(fm('notes: longtext | optional', '{{notes}}'))).toEqual([
      { name: 'notes', label: 'Notes', type: 'longtext', required: false },
    ]);
  });

  it('applies a custom label and description', () => {
    expect(
      fields(
        fm(
          'notes: longtext | label="Extra notes" | desc="Anything"',
          '{{notes}}',
        ),
      ),
    ).toEqual([
      {
        name: 'notes',
        label: 'Extra notes',
        type: 'longtext',
        required: true,
        description: 'Anything',
      },
    ]);
  });

  it('parses select with options and a default', () => {
    expect(
      fields(
        fm(
          'tone: select | options=Formal, Casual, Technical | default=Formal',
          '{{tone}}',
        ),
      ),
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
        fm(
          'areas: multi | options=Security, Performance, Cost | default=Security, Performance',
          '{{areas}}',
        ),
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
    expect(fields(fm('company: | default=Acme', '{{company}}'))).toEqual([
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
    const f = fields(fm('x: select | options="a, b", "c|d"', '{{x}}'))[0];
    expect(f.options).toEqual(['a, b', 'c|d']);
  });

  it('collects multiple fields in order', () => {
    expect(
      fields(fm('a:\nb: longtext | optional', '{{a}} {{b}}')).map(
        (f) => f.name,
      ),
    ).toEqual(['a', 'b']);
  });

  it('resolves the same field referenced multiple times (multi-instance)', () => {
    const p = fm('topic:', 'Research {{topic}}. Summarize {{topic}}.');
    expect(parse(p).errors).toEqual([]);
    expect(fields(p).map((f) => f.name)).toEqual(['topic']);
  });
});

describe('parseWorkflowTemplate — errors and warnings', () => {
  const errs = (p: string) => parse(p).errors;

  it('flags a body ref with no matching field def', () => {
    const e = errs('Research {{company}}');
    expect(e).toHaveLength(1);
    expect(e[0].message).toMatch(/undefined/i);
  });

  it('warns on a field defined but never referenced', () => {
    const r = parse(fm('a:\nb:', '{{a}}'));
    expect(r.errors).toEqual([]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0].message).toMatch(/b/);
  });

  it('flags an unclosed token', () => {
    const e = errs(fm('company:', 'hi {{company'));
    expect(e).toHaveLength(1);
  });

  it('flags an unknown type', () => {
    expect(errs(fm('x: number', 'body'))).toHaveLength(1);
  });

  it('flags a duplicate field name', () => {
    const e = errs(fm('a:\na:', '{{a}}'));
    expect(e).toHaveLength(1);
    expect(e[0].message).toMatch(/duplicate/i);
  });

  it('flags select/multi with zero options', () => {
    expect(errs(fm('x: select', 'body'))).toHaveLength(1);
    expect(errs(fm('x: multi', 'body'))).toHaveLength(1);
  });

  it('flags a default not among options', () => {
    expect(
      errs(fm('t: select | options=A, B | default=C', 'body')),
    ).toHaveLength(1);
    expect(
      errs(fm('t: multi | options=A, B | default=A, C', 'body')),
    ).toHaveLength(1);
  });

  it('flags the reserved step*_output prefix', () => {
    expect(
      errs(fm('step1_output:', '{{step1_output}}')).length,
    ).toBeGreaterThan(0);
  });

  it('flags options on a non-select type', () => {
    expect(errs(fm('x: text | options=A, B', 'body'))).toHaveLength(1);
  });

  it('flags an invalid field name', () => {
    expect(errs(fm('1bad:', '{{x}}')).length).toBeGreaterThan(0);
  });

  it('flags an unknown attribute', () => {
    expect(errs(fm('x: | bogus=1', 'body'))).toHaveLength(1);
  });
});

describe('parseWorkflowTemplate — built-in date/time tokens', () => {
  it('excludes @today/@now from fields and needs no def', () => {
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

  it('substitutes single-value types with the raw value, stripping frontmatter', () => {
    expect(at(fm('company:', 'Hi {{company}}'), { company: 'Acme' })).toBe(
      'Hi Acme',
    );
  });

  it('substitutes a multi-instance ref every time', () => {
    expect(at(fm('topic:', '{{topic}} and {{topic}}'), { topic: 'AI' })).toBe(
      'AI and AI',
    );
  });

  it('joins multi values with ", "', () => {
    expect(
      at(fm('areas: multi | options=A, B, C', '{{areas}}'), {
        areas: ['A', 'C'],
      }),
    ).toBe('A, C');
  });

  it('renders optional empty as an empty string', () => {
    expect(at(fm('notes: | optional', '[{{notes}}]'), {})).toBe('[]');
  });

  it('falls back to a declared default when the value is empty', () => {
    expect(
      at(
        fm(
          'tone: select | options=Formal, Casual | default=Formal',
          '{{tone}}',
        ),
        {},
      ),
    ).toBe('Formal');
  });

  it('unescapes literal braces', () => {
    expect(substitute('\\{{ raw \\}}', [], {}, clock)).toBe('{{ raw }}');
  });

  it('computes @today with an offset, ISO by default', () => {
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
