'use client';

import type { ReactNode } from 'react';
import Select from '@/components/ui/Select';
import { Field } from '@/components/ui/Field';
import {
  clampReasoningEffort,
  isReasoningEffort,
  REASONING_EFFORT_LABELS,
  REASONING_EFFORT_OPTIONS,
  type ReasoningEffort,
} from '@/lib/providers/reasoningEffort';

export interface ReasoningEffortFieldProps {
  label: ReactNode;
  ariaLabel: string;
  value?: ReasoningEffort;
  supported?: readonly ReasoningEffort[];
  /** False while the model catalog is still being fetched. */
  capabilityKnown?: boolean;
  /** Render a saved-but-no-longer-supported value as a warning. */
  showStoredState?: boolean;
  readOnly?: boolean;
  onChange?: (value: ReasoningEffort | undefined) => void;
}

interface ReasoningEffortSummaryProps {
  label: ReactNode;
  value?: ReasoningEffort;
  supported?: readonly ReasoningEffort[];
  /** Use this when the caller already has the resolved runtime value. */
  effectiveValue?: ReasoningEffort;
  capabilityKnown?: boolean;
}

/** Read-only configured/effective effort text for durable and historical views. */
export function ReasoningEffortSummary({
  label,
  value,
  supported,
  effectiveValue,
  capabilityKnown = true,
}: ReasoningEffortSummaryProps) {
  const effective =
    effectiveValue !== undefined
      ? effectiveValue
      : capabilityKnown
        ? clampReasoningEffort(value, supported)
        : undefined;
  const configuredLabel = value
    ? REASONING_EFFORT_LABELS[value]
    : 'Provider default';
  const effectiveLabel = effective
    ? REASONING_EFFORT_LABELS[effective]
    : value && capabilityKnown
      ? 'Provider default'
      : undefined;
  const differs =
    value !== undefined &&
    effectiveLabel !== undefined &&
    effectiveLabel !== configuredLabel;

  return (
    <div className="flex items-start justify-between gap-2 text-xs">
      <span className="text-fg-subtle">{label}</span>
      <span
        className={
          differs ? 'text-warning text-right' : 'text-fg/90 text-right'
        }
        title={
          differs && effectiveLabel
            ? `Saved ${configuredLabel}; runtime uses ${effectiveLabel}`
            : undefined
        }
      >
        {configuredLabel}
        {differs && effectiveLabel ? ` → ${effectiveLabel}` : ''}
        {!differs && !effectiveValue && !capabilityKnown && value
          ? ' · checking…'
          : ''}
      </span>
    </div>
  );
}

/**
 * Model-aware named-effort selector. Provider default is represented by an
 * empty value, so selecting it removes the persisted effort key. Unsupported
 * models render no selector; durable views may still show a saved value's
 * effective Provider-default behavior.
 */
export default function ReasoningEffortField({
  label,
  ariaLabel,
  value,
  supported,
  capabilityKnown = true,
  showStoredState = false,
  readOnly = false,
  onChange,
}: ReasoningEffortFieldProps) {
  if (readOnly) {
    return (
      <ReasoningEffortSummary
        label={label}
        value={value}
        supported={supported}
        capabilityKnown={capabilityKnown}
      />
    );
  }

  // Do not claim that a model is unsupported while its catalog entry is still
  // loading. Once the catalog is available, an absent capability list is
  // authoritative and the control remains hidden for that model.
  if (!capabilityKnown) return null;

  const hasSupportedLevels = !!supported?.length;
  if (!hasSupportedLevels) {
    if (!showStoredState || value === undefined) return null;
    return (
      <div className="flex items-start justify-between gap-2 text-xs">
        <span className="text-fg-subtle">{label}</span>
        <span
          className="max-w-[65%] text-right text-warning"
          title={`Saved ${REASONING_EFFORT_LABELS[value]}; this model uses Provider default`}
        >
          Saved {REASONING_EFFORT_LABELS[value]} · effective Provider default
        </span>
      </div>
    );
  }

  const effective = clampReasoningEffort(value, supported);
  const stale = value !== undefined && effective !== value;
  const options = [
    { value: '', label: 'Provider default' },
    ...REASONING_EFFORT_OPTIONS.filter((option) =>
      supported?.includes(option.value),
    ),
    ...(stale && effective
      ? [
          {
            value,
            label: `${REASONING_EFFORT_LABELS[value]} (saved; uses ${REASONING_EFFORT_LABELS[effective]})`,
          },
        ]
      : []),
  ];
  const hint = stale
    ? `Saved ${REASONING_EFFORT_LABELS[value!]}; this model currently uses ${REASONING_EFFORT_LABELS[effective!]}. Choose a new level to update the saved value.`
    : 'Provider default lets the model choose its native reasoning behavior.';

  return (
    <Field
      label={label}
      hint={hint}
      className="flex-row items-center justify-between gap-2"
    >
      <Select
        aria-label={ariaLabel}
        value={value ?? ''}
        onChange={(event) => {
          const next = event.target.value;
          onChange?.(next && isReasoningEffort(next) ? next : undefined);
        }}
        options={options}
        className="max-w-[60%] text-xs px-2 py-1.5"
      />
    </Field>
  );
}
