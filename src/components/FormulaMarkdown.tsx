import React, { type ComponentProps, type ReactNode } from 'react';
import Markdown, { MarkdownToJSX, RuleType } from 'markdown-to-jsx';
import {
  prepareFormulaMarkdown,
  type FormulaTokenValue,
} from '@/lib/markdown/formulas';

interface FormulaTokenProps {
  token: Extract<FormulaTokenValue, { type: 'formula' }>;
}

const FormulaToken = ({ token }: FormulaTokenProps) => (
  <span
    className={
      token.displayMode
        ? 'yaawc-formula yaawc-formula-display'
        : 'yaawc-formula yaawc-formula-inline'
    }
    dangerouslySetInnerHTML={{ __html: token.html }}
  />
);

const tokenAt = (
  text: string,
  offset: number,
  tokens: Readonly<Record<string, FormulaTokenValue>>,
): { token: string; value: FormulaTokenValue } | undefined => {
  for (const token of Object.keys(tokens)) {
    if (text.startsWith(token, offset)) {
      return { token, value: tokens[token] };
    }
  }
  return undefined;
};

const renderFormulaText = (
  text: string,
  tokens: Readonly<Record<string, FormulaTokenValue>>,
  key: string | number | undefined,
): ReactNode | undefined => {
  let offset = 0;
  let part = 0;
  const children: ReactNode[] = [];

  while (offset < text.length) {
    const match = tokenAt(text, offset, tokens);
    if (match) {
      if (match.value.type === 'formula') {
        children.push(
          <FormulaToken
            key={`${String(key ?? 'text')}-${part++}`}
            token={match.value}
          />,
        );
      } else {
        children.push(match.value.source);
      }
      offset += match.token.length;
      continue;
    }

    let nextTokenOffset = text.length;
    for (const token of Object.keys(tokens)) {
      const tokenOffset = text.indexOf(token, offset);
      if (tokenOffset !== -1 && tokenOffset < nextTokenOffset) {
        nextTokenOffset = tokenOffset;
      }
    }
    if (nextTokenOffset > offset) {
      children.push(text.slice(offset, nextTokenOffset));
      offset = nextTokenOffset;
    }
  }

  if (children.length === 0) return undefined;
  return <React.Fragment key={key}>{children}</React.Fragment>;
};

export interface FormulaMarkdownProps extends Omit<
  ComponentProps<typeof Markdown>,
  'children' | 'options'
> {
  children?: string | null;
  options?: MarkdownToJSX.Options;
}

export const FormulaMarkdown = ({
  children,
  options,
  ...props
}: FormulaMarkdownProps) => {
  const prepared = prepareFormulaMarkdown(children ?? '');
  const callerRenderRule = options?.renderRule;

  const formulaOptions: MarkdownToJSX.Options = {
    ...options,
    renderRule: (next, node, renderChildren, state) => {
      if (node.type === RuleType.text) {
        const formulaText = renderFormulaText(
          node.text,
          prepared.tokens,
          state.key,
        );
        if (formulaText !== undefined) {
          const renderWithFormulas = () => formulaText;
          return callerRenderRule
            ? callerRenderRule(renderWithFormulas, node, renderChildren, state)
            : formulaText;
        }
      }

      return callerRenderRule
        ? callerRenderRule(next, node, renderChildren, state)
        : next();
    },
  };

  return (
    <Markdown {...props} options={formulaOptions}>
      {prepared.text}
    </Markdown>
  );
};

export default FormulaMarkdown;
