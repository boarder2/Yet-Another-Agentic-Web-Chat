'use client';

import CodeMirror, {
  Decoration,
  EditorView,
  RangeSetBuilder,
  ViewPlugin,
  type ViewUpdate,
} from '@uiw/react-codemirror';
import {
  parseWorkflowTemplate,
  splitFrontmatter,
} from '@/lib/workflows/template';

const tokenMark = Decoration.mark({ class: 'cm-ph-token' });
const errorMark = Decoration.mark({ class: 'cm-ph-error' });
const frontmatterLine = Decoration.line({ class: 'cm-ph-frontmatter' });

// Inline marks: per-token accent/error colors on body `{{ … }}` refs plus error
// underlines on malformed frontmatter definition lines. These never overlap each
// other, so they share one RangeSet (overlapping ranges within a set corrupt
// CodeMirror's position mapping — the block tint lives in its own provider below).
function buildMarks(doc: string) {
  const { errors } = parseWorkflowTemplate(doc);
  const { frontmatter, frontmatterOffset, body, bodyOffset } =
    splitFrontmatter(doc);
  const errorStarts = new Set(errors.map((e) => e.index));
  const builder = new RangeSetBuilder<Decoration>();

  if (frontmatter !== null) {
    let offset = frontmatterOffset;
    for (const line of frontmatter.split('\n')) {
      if (errorStarts.has(offset) && line.trim().length > 0) {
        builder.add(offset, offset + line.length, errorMark);
      }
      offset += line.length + 1;
    }
  }

  let i = 0;
  while (i < body.length) {
    if (body[i] === '\\' && body.startsWith('{{', i + 1)) {
      i += 3;
      continue;
    }
    if (body.startsWith('{{', i)) {
      const close = body.indexOf('}}', i + 2);
      const end = close === -1 ? body.length : close + 2;
      const abs = i + bodyOffset;
      const error = errorStarts.has(abs) || close === -1;
      builder.add(abs, end + bodyOffset, error ? errorMark : tokenMark);
      i = end;
      continue;
    }
    i += 1;
  }
  return builder.finish();
}

// Line-level tint over the frontmatter block. A separate provider from the inline
// marks so the two decoration sets may overlap freely.
function buildFrontmatterLines(doc: string) {
  const { frontmatter, frontmatterOffset, bodyOffset } = splitFrontmatter(doc);
  const builder = new RangeSetBuilder<Decoration>();
  if (frontmatter !== null) {
    for (let p = frontmatterOffset; p < bodyOffset; ) {
      builder.add(p, p, frontmatterLine);
      const nl = doc.indexOf('\n', p);
      if (nl === -1) break;
      p = nl + 1;
    }
  }
  return builder.finish();
}

function highlighter(build: (doc: string) => ReturnType<typeof buildMarks>) {
  return ViewPlugin.fromClass(
    class {
      decorations = Decoration.none;
      constructor(view: EditorView) {
        this.decorations = build(view.state.doc.toString());
      }
      update(u: ViewUpdate) {
        if (u.docChanged) this.decorations = build(u.state.doc.toString());
      }
    },
    { decorations: (v) => v.decorations },
  );
}

// Tokens colored via decorations — accent when valid, danger when errored — so
// the caret can never drift out of step with the highlighting.
const placeholderHighlighter = highlighter(buildMarks);
const frontmatterHighlighter = highlighter(buildFrontmatterLines);

// Only the `{{placeholder}}` token colors — everything else comes from the
// built-in `dark` theme, so the editor matches the code-widget editor.
const tokenTheme = EditorView.theme({
  '.cm-ph-token': { color: 'var(--color-accent)' },
  '.cm-ph-error': {
    color: 'var(--color-danger)',
    textDecoration: 'underline wavy',
  },
  '.cm-ph-frontmatter': { backgroundColor: 'var(--color-surface-2)' },
});

const extensions = [
  frontmatterHighlighter,
  placeholderHighlighter,
  EditorView.lineWrapping,
  tokenTheme,
];

/**
 * Prompt authoring control. Only ever imported via `next/dynamic({ ssr: false })`
 * — CodeMirror touches window/document at module load. `minHeight` floors the
 * editor (the builder gives it a tall pane on large screens) while it still
 * grows with content.
 */
export default function PromptEditor({
  value,
  onChange,
  minHeight = '320px',
}: {
  value: string;
  onChange: (v: string) => void;
  minHeight?: string;
}) {
  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      minHeight={minHeight}
      theme="dark"
      extensions={extensions}
      basicSetup={{ lineNumbers: false, foldGutter: false }}
      className="text-sm border border-surface-2 rounded-control overflow-hidden"
    />
  );
}
