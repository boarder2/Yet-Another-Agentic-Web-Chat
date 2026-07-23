'use client';

import CodeMirror, {
  Decoration,
  EditorView,
  RangeSetBuilder,
  ViewPlugin,
  type ViewUpdate,
} from '@uiw/react-codemirror';
import { parseWorkflowTemplate } from '@/lib/workflows/template';

// Locate each `{{ … }}` token span and flag it as errored when its start index
// matches a ParseError (or it never closes). Mirrors the parser's own escape
// handling so highlighting and validation never disagree.
function tokenRanges(
  prompt: string,
): { from: number; to: number; error: boolean }[] {
  const { errors } = parseWorkflowTemplate(prompt);
  const errorStarts = new Set(errors.map((e) => e.index));
  const ranges: { from: number; to: number; error: boolean }[] = [];
  let i = 0;
  while (i < prompt.length) {
    if (prompt[i] === '\\' && prompt.startsWith('{{', i + 1)) {
      i += 3;
      continue;
    }
    if (prompt.startsWith('{{', i)) {
      const close = prompt.indexOf('}}', i + 2);
      const to = close === -1 ? prompt.length : close + 2;
      ranges.push({ from: i, to, error: errorStarts.has(i) || close === -1 });
      i = to;
      continue;
    }
    i += 1;
  }
  return ranges;
}

const tokenMark = Decoration.mark({ class: 'cm-ph-token' });
const errorMark = Decoration.mark({ class: 'cm-ph-error' });

function buildDecorations(doc: string) {
  const builder = new RangeSetBuilder<Decoration>();
  for (const r of tokenRanges(doc)) {
    builder.add(r.from, r.to, r.error ? errorMark : tokenMark);
  }
  return builder.finish();
}

// A real editor (CodeMirror) with `{{placeholder}}` tokens colored via
// decorations — accent when valid, danger when errored — so the caret can never
// drift out of step with the highlighting the way an overlaid mirror can.
const placeholderHighlighter = ViewPlugin.fromClass(
  class {
    decorations = Decoration.none;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view.state.doc.toString());
    }
    update(u: ViewUpdate) {
      if (u.docChanged)
        this.decorations = buildDecorations(u.state.doc.toString());
    }
  },
  { decorations: (v) => v.decorations },
);

// Only the `{{placeholder}}` token colors — everything else comes from the
// built-in `dark` theme, so the editor matches the code-widget editor.
const tokenTheme = EditorView.theme({
  '.cm-ph-token': { color: 'var(--color-accent)' },
  '.cm-ph-error': {
    color: 'var(--color-danger)',
    textDecoration: 'underline wavy',
  },
});

const extensions = [
  placeholderHighlighter,
  EditorView.lineWrapping,
  tokenTheme,
];

/**
 * Prompt authoring control. Only ever imported via `next/dynamic({ ssr: false })`
 * — CodeMirror touches window/document at module load.
 */
export default function PromptEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      height="320px"
      theme="dark"
      extensions={extensions}
      basicSetup={{ lineNumbers: false, foldGutter: false }}
      className="text-sm border border-surface-2 rounded-control overflow-hidden"
    />
  );
}
