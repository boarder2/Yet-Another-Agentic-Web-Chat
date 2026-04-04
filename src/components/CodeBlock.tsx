'use client';

import { useState } from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import {
  oneDark,
  oneLight,
} from 'react-syntax-highlighter/dist/cjs/styles/prism';
import { CheckCheck, Copy as CopyIcon } from 'lucide-react';

export const CodeBlock = ({
  className,
  children,
  hideChrome = false,
}: {
  className?: string;
  children: React.ReactNode;
  hideChrome?: boolean;
}) => {
  // Extract language from className (format could be "language-javascript" or "lang-javascript")
  let language = '';
  if (className) {
    if (className.startsWith('language-')) {
      language = className.replace('language-', '');
    } else if (className.startsWith('lang-')) {
      language = className.replace('lang-', '');
    }
  }

  const content = children as string;
  const [isCopied, setIsCopied] = useState(false);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(content);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const root = document.documentElement;
  const isDark = root.classList.contains('dark');

  const syntaxStyle = isDark ? oneDark : oneLight;
  const backgroundStyle = isDark ? '#1c1c1c' : '#fafafa';

  return (
    <div
      className={`rounded-md overflow-hidden ${hideChrome ? '' : 'my-4 border border-surface-2'} relative group`}
    >
      {!hideChrome && (
        <div className="flex justify-between items-center px-4 py-2 bg-surface-2 border-b border-surface-2 text-xs text-fg/70 font-mono">
          <span>{language}</span>
          <button
            onClick={handleCopyCode}
            className="p-1 rounded-md hover:bg-surface transition duration-200"
            aria-label="Copy code to clipboard"
          >
            {isCopied ? (
              <CheckCheck size={14} className="text-green-500" />
            ) : (
              <CopyIcon size={14} className="text-fg" />
            )}
          </button>
        </div>
      )}
      <SyntaxHighlighter
        language={language || 'text'}
        style={syntaxStyle}
        customStyle={{
          margin: 0,
          padding: '1rem',
          borderRadius: 0,
          backgroundColor: backgroundStyle,
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
