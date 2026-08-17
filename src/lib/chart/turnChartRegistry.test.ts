import { describe, expect, it } from 'vitest';
import { normalizeChartInput } from './chartInput';
import {
  TURN_CHART_MAX_PLACEMENTS,
  TURN_CHART_MAX_REGISTRATIONS,
  restoreTurnChartRegistryFromMilestones,
  TurnChartRegistry,
  TurnChartRegistryError,
} from './turnChartRegistry';

const chart = (title: string) =>
  normalizeChartInput({
    type: 'line',
    title,
    labels: ['A', 'B'],
    series: [{ label: 'Value', values: [1, 2] }],
  });

function deterministicIds(): () => string {
  let next = 1;
  return () => `internal-${next++}`;
}

describe('TurnChartRegistry', () => {
  it('allocates short model handles separately from internal chart IDs', () => {
    const registry = new TurnChartRegistry({ idFactory: deterministicIds() });
    const first = registry.register(chart('First'));
    const second = registry.register(chart('Second'));

    expect(first.handle).toBe('chart_1');
    expect(second.handle).toBe('chart_2');
    expect(first.chartId).toBe('internal-1');
    expect(second.chartId).toBe('internal-2');
    expect(first.chartId).not.toBe(first.handle);
    expect(registry.availableCharts()).toEqual([
      { handle: 'chart_1', title: 'First' },
      { handle: 'chart_2', title: 'Second' },
    ]);
  });

  it('resolves only handles registered in this turn', () => {
    const firstTurn = new TurnChartRegistry({ idFactory: deterministicIds() });
    firstTurn.register(chart('Current'));

    expect(firstTurn.resolve('chart_1')?.title).toBe('Current');
    expect(firstTurn.resolve('internal-1')).toBeUndefined();
    expect(
      new TurnChartRegistry({ idFactory: deterministicIds() }).resolve(
        'chart_1',
      ),
    ).toBeUndefined();
  });

  it('reports available handles and titles for an unknown handle', () => {
    const registry = new TurnChartRegistry({ idFactory: deterministicIds() });
    registry.register(chart('Revenue'));
    registry.register(chart('Costs'));

    let thrown: unknown;
    try {
      registry.require('chart_99');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TurnChartRegistryError);
    if (thrown instanceof TurnChartRegistryError) {
      expect(thrown.code).toBe('unknown_handle');
      expect(thrown.handle).toBe('chart_99');
      expect(thrown.availableCharts).toEqual([
        { handle: 'chart_1', title: 'Revenue' },
        { handle: 'chart_2', title: 'Costs' },
      ]);
      expect(thrown.message).toContain('chart_1 (Revenue)');
      expect(thrown.message).toContain('chart_2 (Costs)');
    }

    expect(() => registry.require(null)).toThrow(
      'Choose a chart from this turn',
    );
  });

  it('allows a registered chart to be placed repeatedly with unique placement IDs', () => {
    const registry = new TurnChartRegistry({ idFactory: deterministicIds() });
    const registration = registry.register(chart('Repeatable'));
    const first = registry.place(registration.handle);
    const second = registry.show(registration.handle);

    expect(first).toMatchObject({
      handle: 'chart_1',
      chartId: registration.chartId,
      title: 'Repeatable',
      placementId: 'placement_1',
      placementNumber: 1,
    });
    expect(second).toMatchObject({
      handle: 'chart_1',
      chartId: registration.chartId,
      title: 'Repeatable',
      placementId: 'placement_2',
      placementNumber: 2,
    });
    expect(registry.placementCount).toBe(2);
    expect(registry.registrationCount).toBe(1);
  });

  it(`rejects the ${TURN_CHART_MAX_REGISTRATIONS + 1}th registration`, () => {
    const registry = new TurnChartRegistry({ idFactory: deterministicIds() });
    for (let index = 0; index < TURN_CHART_MAX_REGISTRATIONS; index += 1) {
      registry.register(chart(`Chart ${index}`));
    }

    let thrown: unknown;
    try {
      registry.register(chart('Too many'));
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TurnChartRegistryError);
    if (thrown instanceof TurnChartRegistryError) {
      expect(thrown.code).toBe('registration_limit');
      expect(thrown.availableCharts).toHaveLength(TURN_CHART_MAX_REGISTRATIONS);
    }
    expect(registry.registrationCount).toBe(TURN_CHART_MAX_REGISTRATIONS);
    expect(registry.resolve('chart_11')).toBeUndefined();
  });

  it(`rejects the ${TURN_CHART_MAX_PLACEMENTS + 1}th placement`, () => {
    const registry = new TurnChartRegistry({ idFactory: deterministicIds() });
    registry.register(chart('Repeatable'));
    for (let index = 0; index < TURN_CHART_MAX_PLACEMENTS; index += 1) {
      registry.place('chart_1');
    }

    let thrown: unknown;
    try {
      registry.place('chart_1');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(TurnChartRegistryError);
    if (thrown instanceof TurnChartRegistryError) {
      expect(thrown.code).toBe('placement_limit');
      expect(thrown.handle).toBe('chart_1');
      expect(thrown.availableCharts).toEqual([
        { handle: 'chart_1', title: 'Repeatable' },
      ]);
    }
    expect(registry.placementCount).toBe(TURN_CHART_MAX_PLACEMENTS);
  });

  it('snapshots and restores registrations, handle allocation, and placement count', () => {
    const original = new TurnChartRegistry({ idFactory: deterministicIds() });
    original.register(chart('First'));
    original.register(chart('Second'));
    original.place('chart_1');
    const snapshot = original.snapshot();

    const restored = TurnChartRegistry.fromSnapshot(snapshot, {
      idFactory: deterministicIds(),
    });

    expect(restored.availableCharts()).toEqual([
      { handle: 'chart_1', title: 'First' },
      { handle: 'chart_2', title: 'Second' },
    ]);
    expect(restored.placementCount).toBe(1);
    expect(restored.place('chart_2')).toMatchObject({
      placementId: 'placement_2',
      placementNumber: 2,
    });
    expect(restored.register(chart('Third'))).toMatchObject({
      handle: 'chart_3',
      chartId: 'internal-3',
    });
  });

  it('does not expose mutable registration data through results or snapshots', () => {
    const registry = new TurnChartRegistry({ idFactory: deterministicIds() });
    const registration = registry.register(chart('Immutable'));
    registration.spec.data[0].series_1 = 999;
    const snapshot = registry.snapshot();
    snapshot.registrations[0].spec.data[0].series_1 = 888;

    expect(registry.resolve('chart_1')?.spec.data[0].series_1).toBe(1);
  });

  it('restores current-turn handles and placement count from persisted milestones', () => {
    const registry = new TurnChartRegistry({ idFactory: deterministicIds() });
    const first = chart('First');
    const second = chart('Second');

    restoreTurnChartRegistryFromMilestones(registry, [
      { type: 'code_execution_pending', data: { approvalId: 'approval-1' } },
      {
        type: 'chart_spec',
        data: { chartId: 'private-1', handle: 'chart_1', spec: first },
      },
      {
        type: 'chart_placement',
        data: { placementId: 'placement_1', chartId: 'private-1' },
      },
      // A replayed milestone must not consume another placement number.
      {
        type: 'chart_placement',
        data: { placementId: 'placement_1', chartId: 'private-1' },
      },
      {
        type: 'chart_spec',
        data: { chartId: 'private-2', turnHandle: 'chart_2', spec: second },
      },
      {
        type: 'chart_placement',
        data: { placementId: 'missing-placement', chartId: 'missing-chart' },
      },
    ]);

    expect(registry.availableCharts()).toEqual([
      { handle: 'chart_1', title: 'First' },
      { handle: 'chart_2', title: 'Second' },
    ]);
    expect(registry.placementCount).toBe(1);
    expect(registry.place('chart_2')).toMatchObject({
      chartId: 'private-2',
      placementId: 'placement_2',
      placementNumber: 2,
    });
    expect(registry.register(chart('Third')).handle).toBe('chart_3');
  });

  it('does not restore isolated panel handles into the parent turn registry', () => {
    const registry = new TurnChartRegistry({ idFactory: deterministicIds() });

    restoreTurnChartRegistryFromMilestones(registry, [
      {
        type: 'chart_spec',
        data: {
          chartId: 'panel_0_private-1',
          handle: 'chart_1',
          executorIdx: 0,
          spec: chart('Panel chart'),
        },
      },
      {
        type: 'panel_executor_chart',
        data: {
          placementId: 'panel_0_placement_1',
          chartId: 'panel_0_private-1',
        },
      },
    ]);

    expect(registry.registrationCount).toBe(0);
    expect(registry.placementCount).toBe(0);
    expect(registry.resolve('chart_1')).toBeUndefined();
  });
});
