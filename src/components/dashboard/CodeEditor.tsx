'use client';

import { useEffect, useMemo, useState } from 'react';
import CodeMirror, { EditorView, type Extension } from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { languages } from '@codemirror/language-data';
import { codeMirrorTheme } from '@/lib/theme/codemirror';
import { useActiveTheme } from '@/lib/theme/useActiveTheme';

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  height?: string;
  readOnly?: boolean;
  // When set, the editing language is picked from the file extension (loaded on
  // demand). When omitted the editor defaults to JavaScript — the dashboard
  // code widget, which is always JS.
  filename?: string;
  // Accessible name for the editable surface (CodeMirror renders no label of
  // its own).
  ariaLabel?: string;
  ariaDescribedBy?: string;
}

// CodeMirror 6 touches window/document at module load, so this component is
// only ever imported via next/dynamic({ ssr: false }).
const CodeEditor = ({
  value,
  onChange,
  height = '320px',
  readOnly = false,
  filename,
  ariaLabel,
  ariaDescribedBy,
}: CodeEditorProps) => {
  const { syntax, mode } = useActiveTheme();
  const theme = useMemo(() => codeMirrorTheme(syntax, mode), [syntax, mode]);
  const [language, setLanguage] = useState<Extension>(() =>
    filename === undefined ? javascript() : [],
  );

  useEffect(() => {
    if (filename === undefined) return;
    let cancelled = false;
    const ext = filename.split('.').pop()?.toLowerCase();
    const desc = ext
      ? languages.find((l) => l.extensions.includes(ext))
      : undefined;
    // Resolve async so the language chunk is only fetched when a file needs it;
    // no match falls back to a plain (unhighlighted) document.
    Promise.resolve(desc ? desc.load() : []).then((support) => {
      if (!cancelled) setLanguage(support);
    });
    return () => {
      cancelled = true;
    };
  }, [filename]);

  return (
    <CodeMirror
      value={value}
      height={height}
      theme={theme}
      readOnly={readOnly}
      extensions={
        ariaLabel || ariaDescribedBy
          ? [
              language,
              EditorView.contentAttributes.of({
                ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
                ...(ariaDescribedBy
                  ? { 'aria-describedby': ariaDescribedBy }
                  : {}),
              }),
            ]
          : [language]
      }
      onChange={onChange}
      basicSetup={{ lineNumbers: true, foldGutter: false }}
      className="text-sm border border-surface-2 rounded-control overflow-hidden"
    />
  );
};

export default CodeEditor;
