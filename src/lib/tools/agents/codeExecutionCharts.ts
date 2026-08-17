import crypto from 'crypto';
import type { EventEmitter } from 'events';
import { emitStreamEvent } from '@/lib/streaming/events';
import {
  normalizeChartInput,
  safeNormalizeChartInput,
} from '@/lib/chart/chartInput';
import {
  TurnChartRegistry,
  TurnChartRegistryError,
  type TurnChartRegistration,
} from '@/lib/chart/turnChartRegistry';

export const CODE_CHART_RECORD_VERSION = 1;
export const CODE_CHART_MAX_RECORDS = 32;
export const CODE_CHART_MAX_RECORD_BYTES = 256 * 1024;

export type CodeChartChannel = {
  prefix: string;
  prelude: string;
};

export type CodeChartEmission = {
  index: number;
  spec?: unknown;
  error?: string;
};

export type CodeChartRegistrationResult = {
  index: number;
  handle?: string;
  title?: string;
  chartId?: string;
  error?: string;
};

export type CodeChartRegistrationOutcome = {
  results: CodeChartRegistrationResult[];
  registrations: TurnChartRegistration[];
  handles: string[];
  titles: string[];
  errors: string[];
};

export type PrivateRecordCapture = {
  records: string[];
  errors: string[];
};

export type PrivateRecordCollectorOptions = {
  maxRecords?: number;
  maxRecordBytes?: number;
};

/**
 * A bounded scanner for the private stdout channel. It returns ordinary stdout
 * while consuming only records bearing the per-execution random prefix.
 */
export class PrivateRecordCollector {
  private readonly prefix: string;
  private readonly maxRecords: number;
  private readonly maxRecordBytes: number;
  private pending = '';
  private readonly captured: string[] = [];
  private readonly captureErrors: string[] = [];
  private ignoredRecords = 0;
  private discardingRecord = false;

  constructor(prefix: string, options: PrivateRecordCollectorOptions = {}) {
    this.prefix = prefix;
    this.maxRecords = Math.max(1, options.maxRecords ?? CODE_CHART_MAX_RECORDS);
    this.maxRecordBytes = Math.max(
      1,
      options.maxRecordBytes ?? CODE_CHART_MAX_RECORD_BYTES,
    );
  }

  /** Consume a stdout chunk and return only user-visible output from it. */
  push(chunk: string): string {
    if (!chunk) return '';
    this.pending += chunk;
    return this.drain(false);
  }

  /** Flush a partial final chunk and return its visible portion. */
  finish(): string {
    return this.drain(true);
  }

  get records(): string[] {
    return [...this.captured];
  }

  get errors(): string[] {
    return [...this.captureErrors];
  }

  capture(): PrivateRecordCapture {
    return { records: this.records, errors: this.errors };
  }

  private drain(final: boolean): string {
    let visible = '';

    while (this.pending.length > 0) {
      if (this.discardingRecord) {
        const newlineIndex = this.pending.indexOf('\n');
        if (newlineIndex < 0) {
          this.pending = '';
          break;
        }
        this.pending = this.pending.slice(newlineIndex + 1);
        this.discardingRecord = false;
        continue;
      }

      const markerIndex = this.pending.indexOf(this.prefix);
      if (markerIndex < 0) {
        if (final) {
          visible += this.pending;
          this.pending = '';
        } else {
          // Retain enough suffix to recognize a marker split across chunks.
          const keep = Math.max(0, this.prefix.length - 1);
          const visibleLength = Math.max(0, this.pending.length - keep);
          visible += this.pending.slice(0, visibleLength);
          this.pending = this.pending.slice(visibleLength);
        }
        break;
      }

      visible += this.pending.slice(0, markerIndex);
      const payloadStart = markerIndex + this.prefix.length;
      const newlineIndex = this.pending.indexOf('\n', payloadStart);
      if (newlineIndex < 0) {
        const payloadBytes = byteLength(this.pending.slice(payloadStart));
        if (!final && payloadBytes <= this.maxRecordBytes) {
          // The visible prefix has already been returned. Keep only the
          // incomplete private record so it is not returned again when the
          // next stdout chunk completes the line.
          this.pending = this.pending.slice(markerIndex);
          break;
        }

        this.captureErrors.push(
          'A private chart record was incomplete or exceeded the transport limit.',
        );
        this.discardingRecord = !final;
        this.pending = final
          ? ''
          : this.pending.slice(payloadStart + this.maxRecordBytes);
        continue;
      }

      const payload = this.pending
        .slice(payloadStart, newlineIndex)
        .replace(/\r$/, '');
      this.accept(payload);
      this.pending = this.pending.slice(newlineIndex + 1);
    }

    return visible;
  }

  private accept(payload: string): void {
    if (byteLength(payload) > this.maxRecordBytes) {
      this.captureErrors.push(
        `A private chart record exceeded the ${this.maxRecordBytes}-byte transport limit.`,
      );
      return;
    }
    if (this.captured.length >= this.maxRecords) {
      this.ignoredRecords += 1;
      if (this.ignoredRecords === 1) {
        this.captureErrors.push(
          `Only the first ${this.maxRecords} private chart records are accepted.`,
        );
      }
      return;
    }
    this.captured.push(payload);
  }
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function channelPrefix(token: string): string {
  return `__YAAWC_CHART_RECORD_${token}__`;
}

/** Create the randomized private channel and its sandbox-side chart helper. */
export function createCodeChartChannel(
  tokenFactory: () => string = () => crypto.randomBytes(18).toString('hex'),
): CodeChartChannel {
  const prefix = channelPrefix(tokenFactory());
  return { prefix, prelude: buildChartHelperPrelude(prefix) };
}

/** Source injected before user code so `chart(spec)` is a global helper. */
export function buildChartHelperPrelude(prefix: string): string {
  return `
;(() => {
  const __yaawcChartRecordPrefix = ${JSON.stringify(prefix)};
  globalThis.chart = function chart(spec) {
    let __yaawcChartRecord;
    try {
      __yaawcChartRecord = JSON.stringify({
        version: ${CODE_CHART_RECORD_VERSION},
        spec,
      });
    } catch {
      __yaawcChartRecord = JSON.stringify({
        version: ${CODE_CHART_RECORD_VERSION},
        error: 'chart(spec) received a non-serializable value',
      });
    }
    process.stdout.write(__yaawcChartRecordPrefix + __yaawcChartRecord + '\\n');
  };
})();
`;
}

/** Inject the helper without changing the source string retained for approval/UI. */
export function injectChartHelper(
  code: string,
  channel: CodeChartChannel,
): string {
  return `${channel.prelude}\n${code}`;
}

/** Decode one private transport record without trusting its contents. */
export function decodeCodeChartRecord(
  payload: string,
  index = 0,
): CodeChartEmission {
  let value: unknown;
  try {
    value = JSON.parse(payload);
  } catch {
    return { index, error: 'chart(spec) emitted malformed machine data.' };
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { index, error: 'chart(spec) emitted a non-object record.' };
  }

  const record = value as {
    version?: unknown;
    spec?: unknown;
    error?: unknown;
  };
  if (record.error !== undefined) {
    return {
      index,
      error:
        typeof record.error === 'string'
          ? record.error
          : 'chart(spec) could not serialize its value.',
    };
  }
  if (record.version !== CODE_CHART_RECORD_VERSION) {
    return {
      index,
      error: 'chart(spec) emitted an unsupported record version.',
    };
  }
  if (!('spec' in record)) {
    return { index, error: 'chart(spec) did not include a chart spec.' };
  }
  return { index, spec: record.spec };
}

/** Decode all captured records while preserving their original order. */
export function decodeCodeChartRecords(
  records: readonly string[],
): CodeChartEmission[] {
  return records.map((record, index) => decodeCodeChartRecord(record, index));
}

function validationMessage(error: {
  issues: Array<{ message: string }>;
}): string {
  return error.issues.map((issue) => issue.message).join('; ');
}

function resultError(
  index: number,
  message: string,
): CodeChartRegistrationResult {
  return { index, error: `Chart ${index + 1}: ${message}` };
}

/**
 * Validate and register private chart emissions only after a clean execution.
 * Every emission is checked independently; a bad record does not discard other
 * valid records from the same successful run.
 */
export function registerCodeExecutionCharts(options: {
  records: readonly string[];
  recordErrors?: readonly string[];
  executionSucceeded: boolean;
  registry: TurnChartRegistry;
  emitter: EventEmitter;
  toolCallId?: string;
}): CodeChartRegistrationOutcome {
  const decoded = decodeCodeChartRecords(options.records);
  const results: CodeChartRegistrationResult[] = [];
  const registrations: TurnChartRegistration[] = [];

  if (!options.executionSucceeded) {
    const discarded =
      options.records.length > 0 || (options.recordErrors?.length ?? 0) > 0;
    if (discarded) {
      results.push(
        resultError(
          0,
          'execution did not finish successfully; chart registrations were discarded',
        ),
      );
    }
    return summarizeCodeChartResults(results, registrations);
  }

  for (const transportError of options.recordErrors ?? []) {
    results.push(resultError(results.length, transportError));
  }

  for (const emission of decoded) {
    if (emission.error) {
      results.push(resultError(emission.index, emission.error));
      continue;
    }

    const normalized = safeNormalizeChartInput(emission.spec);
    if (!normalized.success) {
      results.push(
        resultError(emission.index, validationMessage(normalized.error)),
      );
      continue;
    }

    const snapshot = options.registry.snapshot();
    try {
      const registration = options.registry.register(normalized.data);
      emitStreamEvent(options.emitter, {
        type: 'chart_spec',
        data: {
          chartId: registration.chartId,
          handle: registration.handle,
          spec: registration.spec,
          source: 'code_execution',
          ...(options.toolCallId ? { toolCallId: options.toolCallId } : {}),
        },
      });
      registrations.push(registration);
      results.push({
        index: emission.index,
        handle: registration.handle,
        title: registration.title,
        chartId: registration.chartId,
      });
    } catch (error) {
      options.registry.restore(snapshot);
      const message =
        error instanceof TurnChartRegistryError || error instanceof Error
          ? error.message
          : String(error);
      results.push(resultError(emission.index, message));
    }
  }

  return summarizeCodeChartResults(results, registrations);
}

function summarizeCodeChartResults(
  results: CodeChartRegistrationResult[],
  registrations: TurnChartRegistration[],
): CodeChartRegistrationOutcome {
  return {
    results,
    registrations,
    handles: results.flatMap((result) =>
      result.handle ? [result.handle] : [],
    ),
    titles: results.flatMap((result) => (result.title ? [result.title] : [])),
    errors: results.flatMap((result) => (result.error ? [result.error] : [])),
  };
}

/** Public aliases for callers that use the transport terminology. */
export const createPrivateChartChannel = createCodeChartChannel;
export const buildPrivateChartHelper = buildChartHelperPrelude;
export const capturePrivateRecords = (
  prefix: string,
  options?: PrivateRecordCollectorOptions,
) => new PrivateRecordCollector(prefix, options);
export const parseCodeChartRecords = decodeCodeChartRecords;
export const registerCodeCharts = registerCodeExecutionCharts;

/** Normalize a simplified input for callers that want the protocol validator alone. */
export { normalizeChartInput };
