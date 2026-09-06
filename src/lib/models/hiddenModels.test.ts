import { describe, expect, it } from 'vitest';

import {
  addHiddenModel,
  addHiddenModels,
  isHiddenModel,
  parseHiddenModels,
  removeHiddenModel,
  removeHiddenModels,
  serializeHiddenModels,
  showHiddenModel,
  showHiddenModels,
} from './hiddenModels';

describe('hidden model references', () => {
  it('retains legacy global strings and valid scoped entries while dropping malformed values', () => {
    expect(
      parseHiddenModels([
        'legacy-model',
        { provider: 'openai-compatible:one', model: 'local-model' },
        { provider: 'openai-compatible:two', model: 'same-model', extra: true },
        { provider: '', model: 'missing-provider' },
        '',
        null,
        42,
      ]),
    ).toEqual([
      'legacy-model',
      { provider: 'openai-compatible:one', model: 'local-model' },
    ]);
    expect(parseHiddenModels(JSON.stringify(['legacy-model']))).toEqual([
      'legacy-model',
    ]);
  });

  it('matches legacy strings globally and scoped entries exactly', () => {
    const hidden = [
      'globally-hidden',
      { provider: 'provider-a', model: 'scoped-model' },
    ] as const;

    expect(isHiddenModel(hidden, 'provider-a', 'globally-hidden')).toBe(true);
    expect(isHiddenModel(hidden, 'provider-b', 'globally-hidden')).toBe(true);
    expect(isHiddenModel(hidden, 'provider-a', 'scoped-model')).toBe(true);
    expect(isHiddenModel(hidden, 'provider-b', 'scoped-model')).toBe(false);
  });

  it('adds and removes scoped entries without changing legacy global hides', () => {
    const initial = ['legacy-global'] as const;
    const withScoped = addHiddenModel(initial, 'provider-a', 'shared-model');

    expect(withScoped).toEqual([
      'legacy-global',
      { provider: 'provider-a', model: 'shared-model' },
    ]);
    expect(addHiddenModel(withScoped, 'provider-a', 'shared-model')).toEqual(
      withScoped,
    );
    expect(removeHiddenModel(withScoped, 'provider-a', 'shared-model')).toEqual(
      ['legacy-global'],
    );
    expect(removeHiddenModel(withScoped, 'provider-b', 'shared-model')).toEqual(
      withScoped,
    );
  });

  it('bulk toggles only the requested provider/model pairs and serializes the result', () => {
    const initial = [
      'legacy-model',
      { provider: 'provider-a', model: 'already-hidden' },
    ] as const;
    const models = [
      { provider: 'provider-a', model: 'new-model' },
      { provider: 'provider-b', model: 'new-model' },
    ];

    const hidden = addHiddenModels(initial, models);
    expect(hidden).toEqual([
      'legacy-model',
      { provider: 'provider-a', model: 'already-hidden' },
      { provider: 'provider-a', model: 'new-model' },
      { provider: 'provider-b', model: 'new-model' },
    ]);
    expect(removeHiddenModels(hidden, [models[0]])).toEqual([
      'legacy-model',
      { provider: 'provider-a', model: 'already-hidden' },
      { provider: 'provider-b', model: 'new-model' },
    ]);
    expect(serializeHiddenModels(hidden)).toBe(JSON.stringify(hidden));
  });

  it('shows a provider model by consuming matching legacy global and scoped hides', () => {
    const hidden = [
      'shared-model',
      { provider: 'provider-a', model: 'shared-model' },
      { provider: 'provider-a', model: 'a-only-model' },
      { provider: 'provider-b', model: 'shared-model' },
    ] as const;

    expect(showHiddenModel(hidden, 'provider-a', 'shared-model')).toEqual([
      { provider: 'provider-a', model: 'a-only-model' },
      { provider: 'provider-b', model: 'shared-model' },
    ]);
    expect(
      showHiddenModels(hidden, [
        { provider: 'provider-a', model: 'shared-model' },
        { provider: 'provider-a', model: 'a-only-model' },
      ]),
    ).toEqual([{ provider: 'provider-b', model: 'shared-model' }]);
  });
});
