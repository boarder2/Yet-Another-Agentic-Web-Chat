import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RuleType, type MarkdownToJSX } from 'markdown-to-jsx';
import { prepareFormulaMarkdown } from '@/lib/markdown/formulas';
import FormulaMarkdown from './FormulaMarkdown';

const render = (source: string, options?: MarkdownToJSX.Options): string =>
  renderToStaticMarkup(createElement(FormulaMarkdown, { options }, source));

const count = (source: string, value: string): number =>
  source.split(value).length - 1;

const StrongMarker = ({ children }: { children?: ReactNode }) =>
  createElement('mark', { 'data-test': 'strong' }, children);

describe('FormulaMarkdown', () => {
  it('renders inline and display formulas with accessible KaTeX output', () => {
    const markup = render('Inline $x^2$ here.\n\n$$\n\\frac{1}{2}\n$$');

    expect(markup).toContain('yaawc-formula-inline');
    expect(markup).toContain('yaawc-formula-display');
    expect(markup).toContain('katex-display');
    expect(count(markup, '<math')).toBe(2);
    expect(count(markup, 'application/x-tex')).toBe(2);
    expect(markup).not.toContain('$x^2$');
    expect(markup).not.toContain('$$\n');
  });

  it('renders formulas in visible lists, blockquotes, tables, and link labels only', () => {
    const source = [
      '- list $x$',
      '',
      '> quote \\(y\\)',
      '',
      '| Name | Value |',
      '| --- | --- |',
      '| result | $z$ |',
      '',
      '[label $q$](https://example.test/$destination$)',
      '',
      '`$code$`',
      '',
      '![alt $imageAlt$](/images/$imageDestination$)',
    ].join('\n');
    const markup = render(source);

    expect(count(markup, 'yaawc-formula-inline')).toBe(4);
    expect(markup).toContain('href="https://example.test/$destination$"');
    expect(markup).toContain('src="/images/$imageDestination$"');
    expect(markup).toContain('alt="alt $imageAlt$"');
    expect(markup).toContain('<code>$code$</code>');
    expect(markup).not.toContain('yaawc-formula-display');
  });

  it('keeps bare autolink destinations byte-for-byte while rendering nearby formulas', () => {
    const markup = render(
      'Visit https://example.test/path/$destination$ and email bob$x$@example.test before $visible$.',
    );

    expect(markup).toContain('href="https://example.test/path/$destination$"');
    expect(markup).toContain('href="mailto:bob$x$@example.test"');
    expect(count(markup, 'yaawc-formula-inline')).toBe(1);
    expect(markup).not.toContain('YAAWC_FORMULA');
  });

  it('leaves malformed and incomplete source visibly unchanged without KaTeX errors', () => {
    const source = 'Bad $\\frac{1$ and incomplete \\(x';
    const markup = render(source);

    expect(markup).toContain('$\\frac{1$');
    expect(markup).toContain('\\(x');
    expect(markup).not.toContain('katex');
    expect(markup).not.toContain('#cc0000');
  });

  it('resumes formula rendering after currency and malformed dollar text', () => {
    const source = 'Cost: $20 and $30. Formula $x$. Malformed $y$2. Then $z$.';
    const markup = render(source);

    expect(markup).toContain('Cost: $20 and $30. Formula');
    expect(markup).toContain('$y$2');
    expect(count(markup, 'yaawc-formula-inline')).toBe(2);
    expect(markup).not.toContain('$x$');
    expect(markup).not.toContain('$z$');
  });

  it('preserves tables and bold formatting around ordinary dollar amounts', () => {
    const source = [
      'California topped the list at **$5.62/gallon**, followed by Hawaii ($5.41).',
      '',
      '| Region | Avg. regular gasoline ($/gal) |',
      '|---|---|',
      '| **United States** | **$4.085** |',
      '| **West Coast** | $5.147 |',
    ].join('\n');
    const markup = render(source);

    expect(markup).toContain('<strong>$5.62/gallon</strong>');
    expect(markup).toContain('<table>');
    expect(markup).toContain('<strong>United States</strong>');
    expect(markup).toContain('<strong>$4.085</strong>');
    expect(markup).not.toContain('yaawc-formula');
  });

  it('preserves multiline reference-definition titles without formula sentinels', () => {
    const source = [
      '[label][ref]',
      '',
      '[ref]: /url',
      '  "title $x$"',
      '',
      'Visible $y$',
    ].join('\n');
    const markup = render(source);

    expect(markup).toContain('title $x$');
    expect(markup).toContain('href="/url"');
    expect(count(markup, 'yaawc-formula-inline')).toBe(1);
    expect(markup).not.toContain('YAAWC_FORMULA');
  });

  it('composes caller render rules while resolving only its own formula tokens', () => {
    const options: MarkdownToJSX.Options = {
      renderRule(next, node) {
        if (node.type === RuleType.text) {
          return createElement('mark', { 'data-test': 'text-rule' }, next());
        }
        return next();
      },
      overrides: {
        strong: { component: StrongMarker },
      },
    };
    const markup = render('**Bold** and $x$', options);

    expect(markup).toContain('<mark data-test="strong">');
    expect(markup).toContain('<mark data-test="text-rule">Bold</mark>');
    expect(markup).toContain('yaawc-formula-inline');
  });

  it('does not resolve a sentinel from another preparation', () => {
    const sentinel = Object.keys(prepareFormulaMarkdown('$x$').tokens)[0];
    const markup = render(`literal ${sentinel} and $y$`);

    expect(markup).toContain(sentinel);
    expect(markup).toContain('yaawc-formula-inline');
  });
});
