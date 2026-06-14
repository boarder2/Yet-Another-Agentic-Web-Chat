'use client';

import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  height?: string;
  readOnly?: boolean;
}

// CodeMirror 6 touches window/document at module load, so this component is
// only ever imported via next/dynamic({ ssr: false }).
const CodeEditor = ({
  value,
  onChange,
  height = '320px',
  readOnly = false,
}: CodeEditorProps) => (
  <CodeMirror
    value={value}
    height={height}
    theme="dark"
    readOnly={readOnly}
    extensions={[javascript()]}
    onChange={onChange}
    basicSetup={{ lineNumbers: true, foldGutter: false }}
    className="text-sm border border-surface-2 rounded-control overflow-hidden"
  />
);

export default CodeEditor;
