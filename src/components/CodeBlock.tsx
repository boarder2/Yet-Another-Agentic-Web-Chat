'use client';

import { useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { CheckCheck, Copy as CopyIcon } from 'lucide-react';
import { prismStyleFor } from '@/lib/theme/syntax';
import { useActiveTheme } from '@/lib/theme/useActiveTheme';
import { IconButton } from '@/components/ui/IconButton';

export const CodeBlock = ({
  className,
  children,
  hideChrome = false,
}: {
  className?: string;
  children: React.ReactNode;
  hideChrome?: boolean;
}) => {
  // Extract language from className. Some models emit fence info strings with
  // duplicate/extra tokens (e.g. ```yaml lang-yaml```), which markdown-to-jsx
  // turns into classNames like "lang-yaml lang-yaml" or "lang-yaml lang-yaml".
  // Scan all whitespace-separated tokens and take the first language identifier.
  let language = '';
  if (className) {
    for (const token of className.split(/\s+/)) {
      const match = token.match(/^(?:language-|lang-)(.+)$/);
      if (match) {
        language = match[1];
        break;
      }
    }
  }

  const content = children as string;
  const [isCopied, setIsCopied] = useState(false);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(content);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const theme = useActiveTheme();
  const syntax = prismStyleFor(theme.syntax, theme.mode);

  return (
    <div
      className={`rounded-control overflow-hidden ${hideChrome ? '' : 'my-4 border border-surface-2'} relative group`}
    >
      {!hideChrome && (
        <div className="flex justify-between items-center px-4 py-2 bg-surface-2 border-b border-surface-2 text-xs text-fg-subtle font-mono">
          <span>{language}</span>
          <IconButton
            icon={isCopied ? CheckCheck : CopyIcon}
            label="Copy code to clipboard"
            onClick={handleCopyCode}
            className={`rounded-control p-1 ${isCopied ? '[&_svg]:text-success' : ''}`}
          />
        </div>
      )}
      <SyntaxHighlighter
        language={language || 'text'}
        style={syntax.style}
        customStyle={{
          margin: 0,
          padding: '1rem',
          borderRadius: 0,
          // The syntax style's own fill, so the fence reads as the code theme
          // the user picked. Styles with no solid fill fall back to the app's
          // surface rather than painting nothing.
          backgroundColor: syntax.background ?? 'var(--color-surface)',
        }}
        wrapLines
        wrapLongLines
        showLineNumbers={language !== '' && content.split('\n').length > 1}
        useInlineStyles
        PreTag="div"
      >
        {content}
      </SyntaxHighlighter>
    </div>
  );
};
