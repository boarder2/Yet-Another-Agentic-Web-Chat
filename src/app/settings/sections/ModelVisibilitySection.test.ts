import {
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from 'react';
import { describe, expect, it, vi } from 'vitest';
import AppSwitch from '@/components/ui/AppSwitch';
import { Button } from '@/components/ui/Button';
import type { HiddenModel } from '@/lib/models/hiddenModels';
import ModelVisibilitySection from './ModelVisibilitySection';

type Element = ReactElement<Record<string, unknown>>;

function descendants(node: ReactNode): Element[] {
  const found: Element[] = [];
  Children.forEach(node, (child) => {
    if (!isValidElement(child)) return;
    const element = child as Element;
    found.push(element);
    const children = element.props.children;
    if (children !== undefined) {
      found.push(...descendants(children as ReactNode));
    }
  });
  return found;
}

describe('ModelVisibilitySection', () => {
  it('uses provider metadata and keeps legacy global hides visible as hidden', () => {
    const provider = 'openai-compatible:provider-id';
    const models = {
      'shared-model': { displayName: 'Shared model' },
      'scoped-model': { displayName: 'Scoped model' },
    };
    const hidden: HiddenModel[] = [
      'shared-model',
      { provider, model: 'scoped-model' },
    ];

    const elements = descendants(
      ModelVisibilitySection({
        allModels: { chat: { [provider]: models }, embedding: {} },
        providerMetadata: {
          [provider]: { displayName: 'Local Gateway' },
        },
        hiddenModels: hidden,
        expandedProviders: new Set([`provider-${provider}`]),
        onToggleModel: vi.fn(),
        onToggleProvider: vi.fn(),
        onToggleExpand: vi.fn(),
      }),
    );

    expect(
      elements.some(
        (element) =>
          element.type === 'h4' && element.props.children === 'Local Gateway',
      ),
    ).toBe(true);

    const switches = elements.filter((element) => element.type === AppSwitch);
    expect(switches).toHaveLength(2);
    expect(switches.every((element) => element.props.checked === false)).toBe(
      true,
    );
  });

  it('passes scoped provider/model references to individual and bulk actions', () => {
    const provider = 'openai-compatible:provider-id';
    const models = {
      'local-model': { displayName: 'Local model' },
    };
    const onToggleModel = vi.fn();
    const onToggleProvider = vi.fn();

    const elements = descendants(
      ModelVisibilitySection({
        allModels: { chat: { [provider]: models }, embedding: {} },
        hiddenModels: [],
        expandedProviders: new Set([`provider-${provider}`]),
        onToggleModel,
        onToggleProvider,
        onToggleExpand: vi.fn(),
      }),
    );

    const switchElement = elements.find(
      (element) => element.type === AppSwitch,
    );
    expect(switchElement).toBeDefined();
    (switchElement?.props.onChange as (checked: boolean) => void)(false);
    expect(onToggleModel).toHaveBeenCalledWith(provider, 'local-model', false);

    const hideAll = elements.find(
      (element) =>
        element.type === Button &&
        element.props.title === 'Hide all models in this provider',
    );
    expect(hideAll).toBeDefined();
    (
      hideAll?.props.onClick as (event: { stopPropagation: () => void }) => void
    )({
      stopPropagation: vi.fn(),
    });
    expect(onToggleProvider).toHaveBeenCalledWith(provider, models, false);

    const showAll = elements.find(
      (element) =>
        element.type === Button &&
        element.props.title === 'Show all models in this provider',
    );
    expect(showAll).toBeDefined();
    (
      showAll?.props.onClick as (event: { stopPropagation: () => void }) => void
    )({
      stopPropagation: vi.fn(),
    });
    expect(onToggleProvider).toHaveBeenCalledWith(provider, models, true);
  });
});
