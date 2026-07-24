'use client';

import { useMemo, useState } from 'react';
import type { FieldDef } from '@/lib/workflows/template';
import {
  parseWorkflowTemplate,
  missingRequired,
} from '@/lib/workflows/template';
import { inputCls } from '@/components/workflows/styles';

type Values = Record<string, string | string[]>;

function defaultsFor(fields: FieldDef[]): Values {
  const out: Values = {};
  for (const f of fields) {
    if (f.default !== undefined) out[f.name] = f.default;
    else if (f.type === 'multi') out[f.name] = [];
    else out[f.name] = '';
  }
  return out;
}

/**
 * Renders text / longtext / select / multi controls from a workflow's parsed
 * `fields`, enforces required client-side, applies defaults. Unaware of its
 * mount context (Decision 13) — reused by the Workflows-list launch, the
 * builder preview, and the schedule editor's saved fill-set.
 */
export default function FillForm({
  prompt,
  initialValues,
  submitLabel = 'Run',
  submitting = false,
  hideSubmit = false,
  onSubmit,
  onChange,
}: {
  prompt: string;
  initialValues?: Values;
  submitLabel?: string;
  submitting?: boolean;
  hideSubmit?: boolean;
  onSubmit: (values: Values) => void;
  onChange?: (values: Values) => void;
}) {
  const fields = useMemo(() => parseWorkflowTemplate(prompt).fields, [prompt]);
  const [values, setValues] = useState<Values>(
    () => initialValues ?? defaultsFor(fields),
  );

  const setValue = (name: string, value: string | string[]) => {
    setValues((prev) => {
      const next = { ...prev, [name]: value };
      onChange?.(next);
      return next;
    });
  };

  const missing = missingRequired(fields, values);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (missing.length > 0) return;
    onSubmit(values);
  };

  const submitBtn = hideSubmit ? null : (
    <button
      type="submit"
      disabled={submitting || missing.length > 0}
      className="self-start px-6 py-2 rounded-control bg-accent text-accent-fg font-medium transition-colors duration-150 hover:bg-accent-700 disabled:opacity-50"
    >
      {submitLabel}
    </button>
  );

  // Embedded (hideSubmit) instances live inside a parent <form>, so render a
  // plain <div> to avoid nesting forms; standalone instances own the <form>.
  const Wrapper = hideSubmit ? 'div' : 'form';
  const wrapperProps = hideSubmit ? {} : { onSubmit: handleSubmit };

  if (fields.length === 0) {
    return (
      <Wrapper {...wrapperProps} className="flex flex-col gap-4">
        <p className="text-sm text-fg/60">
          This workflow takes no inputs — run it as-is.
        </p>
        {submitBtn}
      </Wrapper>
    );
  }

  return (
    <Wrapper {...wrapperProps} className="flex flex-col gap-4">
      {fields.map((f) => {
        const value = values[f.name];
        return (
          <div key={f.name} className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-fg/70">
              {f.label}
              {f.required && <span className="text-danger"> *</span>}
            </label>
            {f.description && (
              <p className="text-xs text-fg/50">{f.description}</p>
            )}

            {f.type === 'text' && (
              <input
                type="text"
                aria-label={f.label}
                value={typeof value === 'string' ? value : ''}
                onChange={(e) => setValue(f.name, e.target.value)}
                className={inputCls}
              />
            )}

            {f.type === 'longtext' && (
              <textarea
                aria-label={f.label}
                value={typeof value === 'string' ? value : ''}
                onChange={(e) => setValue(f.name, e.target.value)}
                rows={3}
                className={`${inputCls} resize-y`}
              />
            )}

            {f.type === 'select' && (
              <select
                aria-label={f.label}
                value={typeof value === 'string' ? value : ''}
                onChange={(e) => setValue(f.name, e.target.value)}
                className={inputCls}
              >
                {!f.required && <option value="">—</option>}
                {(f.options ?? []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            )}

            {f.type === 'multi' && (
              <div className="flex flex-wrap gap-2">
                {(f.options ?? []).map((opt) => {
                  const selected = Array.isArray(value) && value.includes(opt);
                  return (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => {
                        const cur = Array.isArray(value) ? value : [];
                        setValue(
                          f.name,
                          selected
                            ? cur.filter((v) => v !== opt)
                            : [...cur, opt],
                        );
                      }}
                      className={`px-3 py-1 rounded-pill text-xs font-medium border transition-colors duration-150 ${
                        selected
                          ? 'bg-accent/10 border-accent text-accent'
                          : 'bg-surface border-surface-2 text-fg/60'
                      }`}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      {submitBtn}
    </Wrapper>
  );
}
