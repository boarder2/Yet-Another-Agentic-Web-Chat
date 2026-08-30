import { createElement, isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import ReasoningEffortField, {
  ReasoningEffortSummary,
  type ReasoningEffortFieldProps,
} from './ReasoningEffortField';

type SelectProps = {
  'aria-label'?: string;
  value?: string;
  options?: Array<{ value: string; label: string }>;
  onChange?: (event: { target: { value: string } }) => void;
};

type FieldProps = {
  children: ReactElement<SelectProps>;
};

function selectElement(
  props: Omit<ReasoningEffortFieldProps, 'onChange'> & {
    onChange?: (value: ReasoningEffortFieldProps['value']) => void;
  },
): ReactElement<SelectProps> {
  const field = ReasoningEffortField(props);
  expect(isValidElement(field)).toBe(true);
  const children = (field as ReactElement<FieldProps>).props.children;
  expect(isValidElement(children)).toBe(true);
  return children as ReactElement<SelectProps>;
}

describe('ReasoningEffortField', () => {
  it('renders an accessible native selector with Provider default and only supported levels', () => {
    const markup = renderToStaticMarkup(
      createElement(ReasoningEffortField, {
        label: 'Chat reasoning effort',
        ariaLabel: 'Chat reasoning effort',
        value: 'low',
        supported: ['low', 'high'],
        onChange: vi.fn(),
      }),
    );

    expect(markup).toContain('aria-label="Chat reasoning effort"');
    expect(markup).toContain('Chat reasoning effort');
    expect(markup).toContain('Provider default lets the model choose');
    expect(markup).toContain('<option value="">Provider default</option>');
    expect(markup).toContain('<option value="low"');
    expect(markup).toContain('>Low</option>');
    expect(markup).toContain('<option value="high"');
    expect(markup).toContain('>High</option>');
    expect(markup).not.toContain('value="medium"');
  });

  it('removes the persisted value when Provider default is selected', () => {
    const onChange = vi.fn();
    const select = selectElement({
      label: 'System reasoning effort',
      ariaLabel: 'System reasoning effort',
      value: 'high',
      supported: ['low', 'high'],
      onChange,
    });

    select.props.onChange?.({ target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith(undefined);

    select.props.onChange?.({ target: { value: 'low' } });
    expect(onChange).toHaveBeenLastCalledWith('low');
  });

  it('keeps a stale saved level visible while showing its clamped runtime level', () => {
    const select = selectElement({
      label: 'Chat reasoning effort',
      ariaLabel: 'Chat reasoning effort',
      value: 'max',
      supported: ['low', 'medium'],
      showStoredState: true,
      onChange: vi.fn(),
    });

    expect(select.props.value).toBe('max');
    expect(select.props.options).toEqual([
      { value: '', label: 'Provider default' },
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'max', label: 'Max (saved; uses Medium)' },
    ]);

    const markup = renderToStaticMarkup(
      createElement(ReasoningEffortSummary, {
        label: 'Chat effort',
        value: 'max',
        supported: ['low', 'medium'],
      }),
    );
    expect(markup).toContain('Max → Medium');
    expect(markup).toContain('Saved Max; runtime uses Medium');
  });

  it('hides unsupported models unless a durable view asks to show the saved state', () => {
    expect(
      ReasoningEffortField({
        label: 'Chat reasoning effort',
        ariaLabel: 'Chat reasoning effort',
        value: 'high',
        supported: undefined,
        capabilityKnown: true,
      }),
    ).toBeNull();

    const stored = renderToStaticMarkup(
      createElement(ReasoningEffortField, {
        label: 'Chat reasoning effort',
        ariaLabel: 'Chat reasoning effort',
        value: 'high',
        supported: undefined,
        capabilityKnown: true,
        showStoredState: true,
      }),
    );
    expect(stored).toContain('Saved High · effective Provider default');
    expect(stored).not.toContain('<select');

    expect(
      ReasoningEffortField({
        label: 'Chat reasoning effort',
        ariaLabel: 'Chat reasoning effort',
        value: 'high',
        supported: ['low', 'high'],
        capabilityKnown: false,
        showStoredState: true,
      }),
    ).toBeNull();
  });
});
