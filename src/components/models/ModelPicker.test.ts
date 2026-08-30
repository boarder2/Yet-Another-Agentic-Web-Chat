import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelSelection } from '@/lib/models/presets';
import ModelField from './ModelField';
import ModelPicker from './ModelPicker';
import ReasoningEffortField from './ReasoningEffortField';

const { useModelsMock } = vi.hoisted(() => ({
  useModelsMock: vi.fn(),
}));

vi.mock('@/lib/hooks/api/useModels', () => ({
  useModels: useModelsMock,
}));

type Element = ReactElement<Record<string, unknown>>;

type ModelFieldProps = {
  role: 'chat' | 'system';
  setSelectedModel: (model: { provider: string; model: string }) => void;
};

type EffortFieldProps = {
  label: string;
  value?: ModelSelection['chatReasoningEffort'];
  onChange?: (value: ModelSelection['chatReasoningEffort']) => void;
  showStoredState?: boolean;
};

function descendants(node: ReactNode): Element[] {
  const found: Element[] = [];
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return;
    const element = child as Element;
    found.push(element);
    const children = element.props.children;
    if (children !== undefined)
      found.push(...descendants(children as ReactNode));
  });
  return found;
}

function pickerElements(value: ModelSelection, fields = { system: true }) {
  return descendants(
    ModelPicker({ value, onChange: vi.fn(), fields, presets: 'none' }),
  );
}

const catalog = {
  chatModelProviders: {
    openai: {
      'gpt-5.4': {
        displayName: 'GPT-5.4',
        supportedReasoningEfforts: ['off', 'low', 'medium', 'high'],
      },
      'gpt-narrow': {
        displayName: 'GPT Narrow',
        supportedReasoningEfforts: ['low', 'medium'],
      },
      'gpt-4o': { displayName: 'GPT-4o' },
    },
    anthropic: {
      'claude-opus-4-6': {
        displayName: 'Claude Opus',
        supportedReasoningEfforts: ['low', 'high'],
      },
    },
  },
};

const baseSelection: ModelSelection = {
  chatProvider: 'openai',
  chatModel: 'gpt-5.4',
  systemProvider: 'anthropic',
  systemModel: 'claude-opus-4-6',
  chatReasoningEffort: 'high',
  systemReasoningEffort: 'low',
};

describe('ModelPicker reasoning-effort wiring', () => {
  beforeEach(() => {
    useModelsMock.mockReset();
    useModelsMock.mockReturnValue({ data: catalog, isFetched: true });
  });

  it('exposes independent Chat and System controls and forwards durable-state props', () => {
    const elements = pickerElements(baseSelection);
    const modelFields = elements.filter(
      (element) => element.type === ModelField,
    );
    const effortFields = elements.filter(
      (element) => element.type === ReasoningEffortField,
    );

    expect(modelFields).toHaveLength(2);
    expect(effortFields.map((element) => element.props.label)).toEqual([
      'Chat reasoning effort',
      'System reasoning effort',
    ]);

    const effortProps = effortFields.map(
      (element) => element.props as EffortFieldProps,
    );
    expect(effortProps.map((props) => props.value)).toEqual(['high', 'low']);
    expect(effortProps.every((props) => props.showStoredState === false)).toBe(
      true,
    );

    const storedElements = descendants(
      ModelPicker({
        value: baseSelection,
        onChange: vi.fn(),
        fields: { system: true },
        presets: 'none',
        showStoredEffortState: true,
      }),
    ).filter((element) => element.type === ReasoningEffortField);
    expect(
      storedElements.every(
        (element) =>
          (element.props as EffortFieldProps).showStoredState === true,
      ),
    ).toBe(true);
  });

  it('normalizes each role independently when its model changes', () => {
    const changes: ModelSelection[] = [];
    const elements = descendants(
      ModelPicker({
        value: baseSelection,
        onChange: (next) => changes.push(next),
        fields: { system: true },
        presets: 'none',
      }),
    );
    const modelFields = elements.filter(
      (element) => element.type === ModelField,
    );
    const chatField = modelFields.find(
      (element) =>
        (element.props as unknown as ModelFieldProps).role === 'chat',
    ) as ReactElement<ModelFieldProps>;
    const systemField = modelFields.find(
      (element) =>
        (element.props as unknown as ModelFieldProps).role === 'system',
    ) as ReactElement<ModelFieldProps>;

    chatField.props.setSelectedModel({
      provider: 'openai',
      model: 'gpt-narrow',
    });
    expect(changes.at(-1)).toEqual({
      ...baseSelection,
      chatModel: 'gpt-narrow',
      chatReasoningEffort: 'medium',
    });

    systemField.props.setSelectedModel({
      provider: 'openai',
      model: 'gpt-4o',
    });
    expect(changes.at(-1)).toEqual({
      ...baseSelection,
      systemProvider: 'openai',
      systemModel: 'gpt-4o',
      systemReasoningEffort: undefined,
    });
  });

  it('does not normalize against an incomplete catalog and can disable effort controls', () => {
    useModelsMock.mockReturnValue({ data: undefined, isFetched: false });
    const changes: ModelSelection[] = [];
    const elements = descendants(
      ModelPicker({
        value: baseSelection,
        onChange: (next) => changes.push(next),
        fields: { system: true },
        presets: 'none',
      }),
    );
    const chatField = elements.find(
      (element) =>
        element.type === ModelField &&
        (element.props as unknown as ModelFieldProps).role === 'chat',
    ) as ReactElement<ModelFieldProps>;

    chatField.props.setSelectedModel({
      provider: 'openai',
      model: 'unknown-while-loading',
    });
    expect(changes.at(-1)).toEqual({
      ...baseSelection,
      chatModel: 'unknown-while-loading',
      chatReasoningEffort: 'high',
    });

    const disabled = descendants(
      ModelPicker({
        value: baseSelection,
        onChange: vi.fn(),
        fields: { system: true, reasoningEffort: false },
        presets: 'none',
      }),
    );
    expect(
      disabled.some((element) => element.type === ReasoningEffortField),
    ).toBe(false);
  });
});
