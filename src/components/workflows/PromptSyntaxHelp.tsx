const rows: { code: string; desc: string }[] = [
  {
    code: '{{topic}}',
    desc: 'Text input, labeled “Topic”. Required by default.',
  },
  { code: '{{notes?}}', desc: 'Trailing ? makes an input optional.' },
  { code: '{{brief:longtext}}', desc: 'Multi-line text box.' },
  {
    code: '{{tone:select:Formal|Casual}}',
    desc: 'Dropdown — pick one of the listed options.',
  },
  {
    code: '{{regions:multi:US|EU|APAC}}',
    desc: 'Pick any number of the listed options.',
  },
  {
    code: '{{tone:select:Formal|Casual=Casual}}',
    desc: 'Prefill a default with =value (multi defaults: =US,EU).',
  },
  { code: '{{@today}}', desc: 'Run date, e.g. 2026-07-22. No input shown.' },
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
];

/**
 * Collapsible reference for the `{{placeholder}}` prompt grammar
 * (`src/lib/workflows/template.ts`) — inputs are parsed straight out of the
 * prompt, so this is the only place the syntax is surfaced to authors.
 */
export default function PromptSyntaxHelp() {
  return (
    <details className="rounded-control border border-surface-2 bg-surface/50 text-sm">
      <summary className="cursor-pointer select-none px-3 py-2 text-fg/70 font-medium">
        Placeholder syntax
      </summary>
      <dl className="flex flex-col gap-2 px-3 pb-3">
        {rows.map((r) => (
          <div
            key={r.code}
            className="flex flex-col gap-0.5 sm:flex-row sm:gap-3"
          >
            <dt className="font-mono text-xs text-accent whitespace-nowrap sm:w-56 sm:shrink-0">
              {r.code}
            </dt>
            <dd className="text-xs text-fg/60">{r.desc}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
