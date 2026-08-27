import { describe, expect, it } from 'vitest';
import { prepareFormulaMarkdown, type FormulaTokenValue } from './formulas';

type FormulaToken = Extract<FormulaTokenValue, { type: 'formula' }>;
type LiteralToken = Extract<FormulaTokenValue, { type: 'literal' }>;

const formulaTokens = (source: string): FormulaToken[] =>
  Object.values(prepareFormulaMarkdown(source).tokens).filter(
    (token): token is FormulaToken => token.type === 'formula',
  );

const tokensOf = (source: string): FormulaTokenValue[] =>
  Object.values(prepareFormulaMarkdown(source).tokens);

const restoreSource = ({
  text,
  tokens,
}: ReturnType<typeof prepareFormulaMarkdown>): string => {
  let restored = text;
  for (const [sentinel, token] of Object.entries(tokens)) {
    restored = restored.split(sentinel).join(token.source);
  }
  return restored;
};

const literalTokens = (source: string): LiteralToken[] =>
  tokensOf(source).filter(
    (token): token is LiteralToken => token.type === 'literal',
  );

describe('prepareFormulaMarkdown', () => {
  it('recognizes inline and display forms and retains their source metadata', () => {
    const source = [
      'Inline $x^2$ and \\(y_1\\).',
      '',
      '$$\\frac{a}{b}$$',
      '',
      '\\[z = 1\\]',
    ].join('\n');
    const prepared = prepareFormulaMarkdown(source);

    expect(
      Object.values(prepared.tokens).map((token) =>
        token.type === 'formula'
          ? { source: token.source, displayMode: token.displayMode }
          : { source: token.source, type: token.type },
      ),
    ).toEqual([
      { source: '$x^2$', displayMode: false },
      { source: '\\(y_1\\)', displayMode: false },
      { source: '$$\\frac{a}{b}$$', displayMode: true },
      { source: '\\[z = 1\\]', displayMode: true },
    ]);
    expect(restoreSource(prepared)).toBe(source);
  });

  it('renders multiline display math as one validated display token', () => {
    const source =
      'Before\n$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$\nAfter';
    const [token] = formulaTokens(source);

    expect(token).toMatchObject({
      source: '$$\n\\begin{aligned}\na &= b \\\\\nc &= d\n\\end{aligned}\n$$',
      displayMode: true,
    });
    expect(token.html).toContain('katex-display');
    expect(token.html).toContain('<math');
    expect(token.html).toContain('application/x-tex');
    expect(restoreSource(prepareFormulaMarkdown(source))).toBe(source);
  });

  it('parses formulas in visible HTML text but not tags, attributes, or verbatim tags', () => {
    const source = [
      '<span data-formula="$attribute$">Visible $text$</span>',
      '<code>$verbatim$</code>',
      '<textarea>$textarea$</textarea>',
    ].join('\n');
    const prepared = prepareFormulaMarkdown(source);

    expect(formulaTokens(source).map(({ source: value }) => value)).toEqual([
      '$text$',
    ]);
    expect(prepared.text).toContain('data-formula="$attribute$"');
    expect(restoreSource(prepared)).toBe(source);
  });

  it('protects inline, fenced, widget, tilde-fenced, and indented code', () => {
    const source = [
      '`$inline$` and ``$double$``',
      '',
      '```yaawc:tool_call',
      '{"value":"$widget$"}',
      '```',
      '',
      '~~~text',
      '$tilde$ $$display$ $tildeDisplay$$',
      '~~~',
      '',
      '    $indented$',
      '',
      'Visible $answer$',
    ].join('\n');
    const prepared = prepareFormulaMarkdown(source);

    expect(formulaTokens(source).map(({ source: value }) => value)).toEqual([
      '$answer$',
    ]);
    expect(prepared.text).toContain('$widget$');
    expect(prepared.text).toContain('$indented$');
    expect(restoreSource(prepared)).toBe(source);
  });

  it('protects image text and destinations while parsing visible link labels', () => {
    const source = [
      '[label $inline$](https://example.test/$destination$ "title $title$")',
      '![alt $imageAlt$](/images/$imageDestination$)',
      '[reference $referenceLabel$][docs]',
      '',
      '[docs]: https://example.test/$referenceDestination$',
    ].join('\n');
    const prepared = prepareFormulaMarkdown(source);

    expect(formulaTokens(source).map(({ source: value }) => value)).toEqual([
      '$inline$',
      '$referenceLabel$',
    ]);
    expect(prepared.text).toContain('$destination$');
    expect(prepared.text).toContain('$title$');
    expect(prepared.text).toContain('$imageAlt$');
    expect(prepared.text).toContain('$imageDestination$');
    expect(prepared.text).toContain('$referenceDestination$');
    expect(restoreSource(prepared)).toBe(source);
  });

  it('protects bare autolink URLs while preserving formulas outside the destination', () => {
    const source =
      'Visit https://example.test/path/$destination$ and email bob$x$@example.test before $visible$.';
    const prepared = prepareFormulaMarkdown(source);

    expect(formulaTokens(source).map(({ source: value }) => value)).toEqual([
      '$visible$',
    ]);
    expect(prepared.text).toContain('https://example.test/path/$destination$');
    expect(prepared.text).toContain('bob$x$@example.test');
    expect(restoreSource(prepared)).toBe(source);
  });

  it('protects multi-line reference-definition titles', () => {
    const source = [
      '[label][ref]',
      '',
      '[ref]: /url',
      '  "title $x$"',
      '',
      'Visible $y$',
    ].join('\n');
    const prepared = prepareFormulaMarkdown(source);

    expect(formulaTokens(source).map(({ source: value }) => value)).toEqual([
      '$y$',
    ]);
    expect(prepared.text).toContain('"title $x$"');
    expect(restoreSource(prepared)).toBe(source);
  });

  it('keeps formulas in ordinary visible Markdown structures', () => {
    const source = [
      '- item $x$',
      '- second \\(y\\)',
      '',
      '> quote $$z^2$$',
      '',
      '| Name | Value |',
      '| --- | --- |',
      '| result | $q$ |',
    ].join('\n');
    const prepared = prepareFormulaMarkdown(source);

    expect(formulaTokens(source).map(({ source: value }) => value)).toEqual([
      '$x$',
      '\\(y\\)',
      '$$z^2$$',
      '$q$',
    ]);
    expect(restoreSource(prepared)).toBe(source);
  });

  it('does not interpret escaped dollars, currency, whitespace-padded, or digit-adjacent delimiters', () => {
    const literalSources = [
      'Price: $20 and $30',
      'Escaped: \\$x\\$',
      'Whitespace: $ x$ and $x $',
      'Adjacent: $x$2',
    ];

    for (const source of literalSources) {
      const prepared = prepareFormulaMarkdown(source);
      expect(formulaTokens(source), source).toHaveLength(0);
      expect(restoreSource(prepared), source).toBe(source);
    }

    expect(formulaTokens('A valid numeric formula is $20$')).toHaveLength(1);
    expect(
      formulaTokens('Use \\(20 and 30\\) when dollar syntax is ambiguous'),
    ).toHaveLength(1);
  });

  it('resumes at later dollar delimiters after rejected candidates', () => {
    const cases = [
      {
        source: 'Cost: $20 and $30. Formula $x$.',
        formula: '$x$',
      },
      {
        source: 'Cost: $20. Formula $x$.',
        formula: '$x$',
      },
      {
        source: 'Malformed $x$2. Formula $y$.',
        formula: '$y$',
      },
      {
        source: 'Malformed $ x$. Formula $z$.',
        formula: '$z$',
      },
    ];

    for (const { source, formula } of cases) {
      expect(
        formulaTokens(source).map(({ source: value }) => value),
        source,
      ).toEqual([formula]);
      expect(restoreSource(prepareFormulaMarkdown(source)), source).toBe(
        source,
      );
    }
  });

  it('resumes at later backslash delimiters after rejected candidates', () => {
    const cases = [
      {
        source: 'Malformed \\(\\). Formula \\(z\\).',
        formula: '\\(z\\)',
      },
      {
        source: 'Malformed \\( broken. Formula \\(z\\).',
        formula: '\\(z\\)',
      },
      {
        source: 'Malformed \\[\\]. Formula \\[z\\].',
        formula: '\\[z\\]',
      },
      {
        source: 'Malformed \\[ broken. Formula \\[z\\].',
        formula: '\\[z\\]',
      },
    ];

    for (const { source, formula } of cases) {
      expect(
        formulaTokens(source).map(({ source: value }) => value),
        source,
      ).toEqual([formula]);
      expect(restoreSource(prepareFormulaMarkdown(source)), source).toBe(
        source,
      );
    }
  });

  it('keeps incomplete candidates exact without hiding following Markdown', () => {
    const sources = [
      'incomplete $x with **bold**',
      'incomplete $$x with **bold**',
      'incomplete \\(x with **bold**',
      'incomplete \\[x with **bold**',
    ];

    for (const source of sources) {
      const prepared = prepareFormulaMarkdown(source);
      expect(formulaTokens(source), source).toHaveLength(0);
      expect(restoreSource(prepared), source).toBe(source);
      expect(prepared.text, source).toContain('**bold**');
    }
  });

  it('does not replace Markdown structure between ordinary dollar amounts', () => {
    const source = [
      'California topped the list at **$5.62/gallon**, followed by Hawaii ($5.41).',
      '',
      '| Region | Avg. regular gasoline ($/gal) |',
      '|---|---|',
      '| **United States** | **$4.085** |',
      '| **West Coast** | $5.147 |',
    ].join('\n');
    const prepared = prepareFormulaMarkdown(source);

    expect(formulaTokens(source)).toHaveLength(0);
    expect(literalTokens(source)).toHaveLength(0);
    expect(prepared.text).toBe(source);
  });

  it('keeps malformed, unsupported, macro-defining, and trust-requiring expressions literal', () => {
    const sources = [
      'Malformed $\\frac{1$',
      'Unsupported $\\notARealCommand$',
      'Untrusted $\\href{https://evil.example}{evil}$',
      'Untrusted $\\url{https://evil.example}$',
      'Macro $\\newcommand{\\foo}{x}\\foo$',
      'HTML $\\htmlClass{evil}{x}$',
    ];

    for (const source of sources) {
      const prepared = prepareFormulaMarkdown(source);
      expect(formulaTokens(source), source).toHaveLength(0);
      expect(restoreSource(prepared), source).toBe(source);
    }
  });

  it('produces accessible safe KaTeX for valid expressions without error or trust-gated markup', () => {
    const [token] = formulaTokens('Safe $\\frac{1}{2}$');

    expect(token.html).toContain('katex');
    expect(token.html).toContain('katex-mathml');
    expect(token.html).toContain('<math');
    expect(token.html).toContain('application/x-tex');
    expect(token.html).not.toContain('#cc0000');
    expect(token.html).not.toMatch(/<(?:a|img|script|iframe)\b/i);
  });

  it('renders safe KaTeX commands whose visual output includes static SVG', () => {
    const source = 'Vector $\\vec{x}$ and overbrace $\\overbrace{x}^{n}$';
    const tokens = formulaTokens(source);

    expect(tokens.map(({ source: value }) => value)).toEqual([
      '$\\vec{x}$',
      '$\\overbrace{x}^{n}$',
    ]);
    expect(tokens.every(({ html }) => html.includes('<svg'))).toBe(true);
    expect(tokens.every(({ html }) => html.includes('katex-mathml'))).toBe(
      true,
    );
    expect(restoreSource(prepareFormulaMarkdown(source))).toBe(source);
  });

  it('keeps user text containing a sentinel from another preparation unresolved', () => {
    const previous = prepareFormulaMarkdown('$x$');
    const previousSentinel = Object.keys(previous.tokens)[0];
    const source = `literal ${previousSentinel} and $y$`;
    const prepared = prepareFormulaMarkdown(source);

    expect(prepared.text).toContain(previousSentinel);
    expect(prepared.tokens[previousSentinel]).toBeUndefined();
    expect(formulaTokens(source).map(({ source: value }) => value)).toEqual([
      '$y$',
    ]);
    expect(restoreSource(prepared)).toBe(source);
  });
});
