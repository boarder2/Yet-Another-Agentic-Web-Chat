import { generateId } from '@/lib/utils/id';
import { ChartSpecSchema, type ChartSpec } from './chartSpec';

export const TURN_CHART_MAX_REGISTRATIONS = 10;
export const TURN_CHART_MAX_PLACEMENTS = 20;

export interface TurnChartMilestone {
  type: string;
  data?: unknown;
}

export interface TurnChartRegistration {
  handle: string;
  chartId: string;
  title: string;
  spec: ChartSpec;
}

export interface TurnChartPlacement extends TurnChartRegistration {
  placementId: string;
  placementNumber: number;
}

export interface AvailableTurnChart {
  handle: string;
  title: string;
}

export interface TurnChartRegistrySnapshot {
  registrations: TurnChartRegistration[];
  nextHandle: number;
  placementCount: number;
  /** Handles shown at least once; absent in older snapshots. */
  placedHandles?: string[];
}

export interface TurnChartRegistryOptions {
  idFactory?: () => string;
  snapshot?: TurnChartRegistrySnapshot;
}

export type TurnChartRegistryErrorCode =
  | 'unknown_handle'
  | 'registration_limit'
  | 'placement_limit'
  | 'invalid_snapshot';

export class TurnChartRegistryError extends Error {
  readonly code: TurnChartRegistryErrorCode;
  readonly availableCharts: AvailableTurnChart[];
  readonly handle?: string;

  constructor(
    code: TurnChartRegistryErrorCode,
    message: string,
    availableCharts: AvailableTurnChart[] = [],
    handle?: string,
  ) {
    super(message);
    this.name = 'TurnChartRegistryError';
    this.code = code;
    this.availableCharts = availableCharts;
    this.handle = handle;
  }
}

function cloneSpec(spec: ChartSpec): ChartSpec {
  return {
    ...spec,
    data: spec.data.map((row) => ({ ...row })),
    series: spec.series.map((series) => ({ ...series })),
    ...(spec.options ? { options: { ...spec.options } } : {}),
  };
}

function cloneRegistration(
  registration: TurnChartRegistration,
): TurnChartRegistration {
  return { ...registration, spec: cloneSpec(registration.spec) };
}

function clonePlacement(placement: TurnChartPlacement): TurnChartPlacement {
  return { ...placement, spec: cloneSpec(placement.spec) };
}

function availableText(charts: readonly AvailableTurnChart[]): string {
  if (charts.length === 0) return 'No charts are available in this turn.';
  return charts.map(({ handle, title }) => `${handle} (${title})`).join(', ');
}

/** A turn-local mapping from short model handles to private chart IDs. */
export class TurnChartRegistry {
  private readonly idFactory: () => string;
  private readonly registrations = new Map<string, TurnChartRegistration>();
  private nextHandle = 1;
  private placementCountValue = 0;
  private readonly placedHandles = new Set<string>();

  constructor(options: TurnChartRegistryOptions = {}) {
    this.idFactory = options.idFactory ?? generateId;
    if (options.snapshot) this.restore(options.snapshot);
  }

  get registrationCount(): number {
    return this.registrations.size;
  }

  get placementCount(): number {
    return this.placementCountValue;
  }

  register(spec: ChartSpec): TurnChartRegistration {
    if (this.registrations.size >= TURN_CHART_MAX_REGISTRATIONS) {
      throw new TurnChartRegistryError(
        'registration_limit',
        `A turn can register at most ${TURN_CHART_MAX_REGISTRATIONS} charts. Available charts: ${availableText(this.availableCharts())}`,
        this.availableCharts(),
      );
    }

    const handle = this.allocateHandle();
    const chartId = this.allocateChartId();
    const title =
      typeof spec.title === 'string' && spec.title.trim().length > 0
        ? spec.title.trim()
        : 'Untitled chart';
    const registration: TurnChartRegistration = {
      handle,
      chartId,
      title,
      spec: cloneSpec(spec),
    };
    this.registrations.set(handle, registration);
    return cloneRegistration(registration);
  }

  resolve(handle: unknown): TurnChartRegistration | undefined {
    if (typeof handle !== 'string') return undefined;
    const registration = this.registrations.get(handle);
    return registration ? cloneRegistration(registration) : undefined;
  }

  require(handle: unknown): TurnChartRegistration {
    const registration = this.resolve(handle);
    if (registration) return registration;

    const displayHandle = typeof handle === 'string' ? handle : String(handle);
    const available = this.availableCharts();
    throw new TurnChartRegistryError(
      'unknown_handle',
      `Unknown chart handle "${displayHandle}". Choose a chart from this turn: ${availableText(available)}`,
      available,
      typeof handle === 'string' ? handle : undefined,
    );
  }

  place(handle: unknown): TurnChartPlacement {
    const registration = this.require(handle);
    if (this.placementCountValue >= TURN_CHART_MAX_PLACEMENTS) {
      const available = this.availableCharts();
      throw new TurnChartRegistryError(
        'placement_limit',
        `A turn can show charts at most ${TURN_CHART_MAX_PLACEMENTS} times. Available charts: ${availableText(available)}`,
        available,
        typeof handle === 'string' ? handle : undefined,
      );
    }

    this.placementCountValue += 1;
    this.placedHandles.add(registration.handle);
    return clonePlacement({
      ...registration,
      placementId: `placement_${this.placementCountValue}`,
      placementNumber: this.placementCountValue,
    });
  }

  /** True once the chart has been placed, however that placement was requested. */
  isPlaced(handle: unknown): boolean {
    return typeof handle === 'string' && this.placedHandles.has(handle);
  }

  availableCharts(): AvailableTurnChart[] {
    return [...this.registrations.values()].map(({ handle, title }) => ({
      handle,
      title,
    }));
  }

  snapshot(): TurnChartRegistrySnapshot {
    return {
      registrations: [...this.registrations.values()].map(cloneRegistration),
      nextHandle: this.nextHandle,
      placementCount: this.placementCountValue,
      placedHandles: [...this.placedHandles],
    };
  }

  restore(snapshot: TurnChartRegistrySnapshot): void {
    if (
      !snapshot ||
      !Array.isArray(snapshot.registrations) ||
      !Number.isInteger(snapshot.nextHandle) ||
      snapshot.nextHandle < 1 ||
      !Number.isInteger(snapshot.placementCount) ||
      snapshot.placementCount < 0 ||
      snapshot.placementCount > TURN_CHART_MAX_PLACEMENTS ||
      snapshot.registrations.length > TURN_CHART_MAX_REGISTRATIONS
    ) {
      throw new TurnChartRegistryError(
        'invalid_snapshot',
        'Invalid turn chart registry snapshot.',
      );
    }

    const restored = new Map<string, TurnChartRegistration>();
    const chartIds = new Set<string>();
    for (const entry of snapshot.registrations) {
      if (
        !entry ||
        typeof entry.handle !== 'string' ||
        typeof entry.chartId !== 'string' ||
        typeof entry.title !== 'string' ||
        !entry.spec ||
        restored.has(entry.handle) ||
        chartIds.has(entry.chartId)
      ) {
        throw new TurnChartRegistryError(
          'invalid_snapshot',
          'Invalid turn chart registry snapshot.',
        );
      }
      restored.set(entry.handle, {
        handle: entry.handle,
        chartId: entry.chartId,
        title: entry.title,
        spec: cloneSpec(entry.spec),
      });
      chartIds.add(entry.chartId);
    }

    this.registrations.clear();
    for (const [handle, registration] of restored) {
      this.registrations.set(handle, registration);
    }
    this.nextHandle = snapshot.nextHandle;
    this.placementCountValue = snapshot.placementCount;
    this.placedHandles.clear();
    for (const handle of snapshot.placedHandles ?? []) {
      if (restored.has(handle)) this.placedHandles.add(handle);
    }
  }

  private allocateHandle(): string {
    while (this.registrations.has(`chart_${this.nextHandle}`)) {
      this.nextHandle += 1;
    }
    const handle = `chart_${this.nextHandle}`;
    this.nextHandle += 1;
    return handle;
  }

  private allocateChartId(): string {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const chartId = this.idFactory();
      if (
        typeof chartId === 'string' &&
        chartId.length > 0 &&
        ![...this.registrations.values()].some(
          (registration) => registration.chartId === chartId,
        )
      ) {
        return chartId;
      }
    }
    throw new TurnChartRegistryError(
      'invalid_snapshot',
      'Could not allocate a unique internal chart ID.',
      this.availableCharts(),
    );
  }
}

/**
 * Rebuild a turn registry from persisted registration/placement milestones.
 * Invalid or legacy chart events are ignored so a stale run can still resume
 * its other tools; only the current turn's short handles are restored.
 */
export function restoreTurnChartRegistryFromMilestones(
  registry: TurnChartRegistry,
  milestones: Iterable<TurnChartMilestone>,
): void {
  const registrations: TurnChartRegistration[] = [];
  const byHandle = new Set<string>();
  const handleByChartId = new Map<string, string>();
  const placementIds = new Set<string>();
  const placedHandles = new Set<string>();
  let maxHandle = 0;

  for (const milestone of milestones) {
    if (milestone.type === 'chart_spec') {
      const data = milestone.data;
      if (!data || typeof data !== 'object') continue;
      const value = data as {
        chartId?: unknown;
        handle?: unknown;
        turnHandle?: unknown;
        spec?: unknown;
        executorIdx?: unknown;
      };
      // Panel executors have isolated registries. Their registrations are
      // forwarded for rendering, but must never become parent-turn handles.
      if (typeof value.executorIdx === 'number') continue;
      const chartId = value.chartId;
      const handle = value.handle ?? value.turnHandle;
      if (
        typeof chartId !== 'string' ||
        chartId.length === 0 ||
        typeof handle !== 'string' ||
        !/^chart_[1-9]\d*$/.test(handle) ||
        byHandle.has(handle) ||
        handleByChartId.has(chartId) ||
        registrations.length >= TURN_CHART_MAX_REGISTRATIONS
      ) {
        continue;
      }
      const parsed = ChartSpecSchema.safeParse(value.spec);
      if (!parsed.success) continue;

      const title = parsed.data.title?.trim() || 'Untitled chart';
      registrations.push({
        handle,
        chartId,
        title,
        spec: parsed.data,
      });
      byHandle.add(handle);
      handleByChartId.set(chartId, handle);
      maxHandle = Math.max(maxHandle, Number(handle.slice('chart_'.length)));
      continue;
    }

    if (milestone.type !== 'chart_placement') continue;
    const data = milestone.data;
    if (!data || typeof data !== 'object') continue;
    const value = data as { placementId?: unknown; chartId?: unknown };
    if (
      typeof value.placementId === 'string' &&
      value.placementId.length > 0 &&
      typeof value.chartId === 'string' &&
      handleByChartId.has(value.chartId)
    ) {
      if (placementIds.size < TURN_CHART_MAX_PLACEMENTS) {
        placementIds.add(value.placementId);
        placedHandles.add(handleByChartId.get(value.chartId) as string);
      }
    }
  }

  registry.restore({
    registrations,
    nextHandle: Math.max(1, maxHandle + 1),
    placementCount: placementIds.size,
    placedHandles: [...placedHandles],
  });
}
