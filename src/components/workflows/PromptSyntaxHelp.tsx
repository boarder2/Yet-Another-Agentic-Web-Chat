const example = `---
topic:
tone: select | options=Formal, Casual | default=Formal
notes: longtext | optional | label="Extra notes" | desc="Anything else"
---
Research {{topic}} in a {{tone}} voice. Summarize {{topic}} for {{@today}}.`;

type Row = { code: string; desc: string };

const sections: { title: string; rows: Row[] }[] = [
  {
    title: 'Input types',
    rows: [
      {
        code: 'text',
        desc: 'Single-line text input — the default when no type is given.',
      },
      { code: 'longtext', desc: 'Multi-line text area for longer input.' },
      { code: 'select', desc: 'Dropdown — pick one of the declared options.' },
      {
        code: 'multi',
        desc: 'Chip toggles — pick any number of the declared options.',
      },
    ],
  },
  {
    title: 'Defining a field',
    rows: [
      {
        code: 'name:',
        desc: 'A bare colon declares a required text field, labeled from the name.',
      },
      {
        code: 'name: <type>',
        desc: 'Set the input type after the colon.',
      },
      {
        code: '| optional',
        desc: 'Fields are required by default; this flips it.',
      },
      {
        code: '| label="…"',
        desc: 'Custom display name (else humanized from the name).',
      },
      { code: '| desc="…"', desc: 'Helper text shown under the field.' },
      {
        code: '| options=a, b, c',
        desc: 'Choices for select/multi. Quote values containing , or |.',
      },
      { code: '| default=a', desc: 'Prefill a value (multi: default=a, b).' },
    ],
  },
  {
    title: 'In the body',
    rows: [
      {
        code: '{{name}}',
        desc: 'Reference a field — any number of times.',
      },
      {
        code: '{{@today}}',
        desc: 'Run date, e.g. 2026-07-22. No input shown.',
      },
      { code: '{{@now}}', desc: 'Run date + time, e.g. 2026-07-22 14:30.' },
      {
        code: '{{@today-7d}}',
        desc: 'Offset the date: ± a number of d/w/m/y/h/min.',
      },
      {
        code: '{{@today:long}}',
        desc: 'Format a date: :long → July 22, 2026, :short → 07/22/2026.',
      },
      { code: '\\{{ \\}}', desc: 'Escape braces to write a literal {{ or }}.' },
    ],
  },
];

/**
 * Collapsible reference for the workflow prompt grammar
 * (`src/lib/workflows/template.ts`) — inputs are declared in an optional
 * frontmatter block and referenced bare in the body, so this is the only place
 * the syntax is surfaced to authors.
 */
export default function PromptSyntaxHelp() {
  return (
    <details className="rounded-control border border-surface-2 bg-surface/50 text-sm">
      <summary className="cursor-pointer select-none px-3 py-2 text-fg-muted font-medium">
        Prompt syntax
      </summary>
      <div className="flex flex-col gap-4 px-3 pb-3">
        <pre className="font-mono text-xs text-fg-muted bg-surface rounded-control border border-surface-2 p-2 overflow-x-auto whitespace-pre">
          {example}
        </pre>
        {sections.map((section) => (
          <div key={section.title} className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-fg-subtle">
              {section.title}
            </p>
            <dl className="flex flex-col gap-2">
              {section.rows.map((r) => (
                <div
                  key={r.code}
                  className="flex flex-col gap-0.5 sm:flex-row sm:gap-3"
                >
                  <dt className="font-mono text-xs text-accent whitespace-nowrap sm:w-44 sm:shrink-0">
                    {r.code}
                  </dt>
                  <dd className="text-xs text-fg-muted">{r.desc}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </details>
  );
}
