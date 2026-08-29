/**
 * The OpenRouter provider quantization contract. This module deliberately has
 * no server- or client-only dependencies so the same allow-list and parser can
 * be used by the settings route, server-side provider loading, and the settings
 * UI.
 */

export const OPENROUTER_QUANTIZATIONS_SETTING_KEY =
  'openrouterQuantizations' as const;

/** Quantizations accepted by OpenRouter's provider routing preference. */
export const OPENROUTER_QUANTIZATIONS = [
  'int4',
  'int8',
  'fp4',
  'mxfp4',
  'nvfp4',
  'fp6',
  'fp8',
  'mxfp8',
  'fp16',
  'bf16',
  'fp32',
] as const;

/** Alias emphasizing that this is the fixed value list, not user input. */
export const OPENROUTER_QUANTIZATION_VALUES = OPENROUTER_QUANTIZATIONS;

export type OpenRouterQuantization = (typeof OPENROUTER_QUANTIZATIONS)[number];

export type OpenRouterQuantizationGroup = 'Integer' | 'Floating point';

export interface OpenRouterQuantizationOption {
  readonly value: OpenRouterQuantization;
  readonly label: string;
  readonly group: OpenRouterQuantizationGroup;
}

/** Display metadata shared by every OpenRouter quantization selector. */
export const OPENROUTER_QUANTIZATION_OPTIONS = [
  { value: 'int4', label: 'INT4', group: 'Integer' },
  { value: 'int8', label: 'INT8', group: 'Integer' },
  { value: 'fp4', label: 'FP4', group: 'Floating point' },
  { value: 'mxfp4', label: 'MXFP4', group: 'Floating point' },
  { value: 'nvfp4', label: 'NVFP4', group: 'Floating point' },
  { value: 'fp6', label: 'FP6', group: 'Floating point' },
  { value: 'fp8', label: 'FP8', group: 'Floating point' },
  { value: 'mxfp8', label: 'MXFP8', group: 'Floating point' },
  { value: 'fp16', label: 'FP16', group: 'Floating point' },
  { value: 'bf16', label: 'BF16', group: 'Floating point' },
  { value: 'fp32', label: 'FP32', group: 'Floating point' },
] as const satisfies readonly OpenRouterQuantizationOption[];

const OPENROUTER_QUANTIZATION_SET: ReadonlySet<string> = new Set(
  OPENROUTER_QUANTIZATIONS,
);

export type OpenRouterQuantizationParseResult =
  | {
      valid: true;
      raw: string | null;
      quantizations: OpenRouterQuantization[];
      canonical: string;
    }
  | {
      valid: false;
      raw: string | null;
      quantizations: null;
      error: string;
    };

function invalidResult(
  raw: string | null,
  error: string,
): OpenRouterQuantizationParseResult {
  return { valid: false, raw, quantizations: null, error };
}

/**
 * Parse the serialized setting without weakening it. Missing state means the
 * default unrestricted routing, while every present value must be a JSON array
 * containing only distinct supported values. Valid arrays are returned in the
 * fixed contract order and with a compact canonical serialization.
 */
export function parseOpenRouterQuantizations(
  rawValue: unknown,
): OpenRouterQuantizationParseResult {
  if (rawValue === undefined || rawValue === null) {
    return {
      valid: true,
      raw: null,
      quantizations: [],
      canonical: '[]',
    };
  }

  if (typeof rawValue !== 'string') {
    return invalidResult(
      null,
      'Expected a JSON array of supported OpenRouter quantizations.',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawValue);
  } catch {
    return invalidResult(rawValue, 'Expected valid JSON.');
  }

  if (!Array.isArray(parsed)) {
    return invalidResult(rawValue, 'Expected a JSON array.');
  }

  const selected = new Set<string>();
  for (const value of parsed) {
    if (typeof value !== 'string' || !OPENROUTER_QUANTIZATION_SET.has(value)) {
      return invalidResult(
        rawValue,
        'Contains an unsupported OpenRouter quantization.',
      );
    }
    if (selected.has(value)) {
      return invalidResult(
        rawValue,
        'Contains duplicate OpenRouter quantizations.',
      );
    }
    selected.add(value);
  }

  const quantizations = OPENROUTER_QUANTIZATIONS.filter((value) =>
    selected.has(value),
  );
  return {
    valid: true,
    raw: rawValue,
    quantizations: [...quantizations],
    canonical: JSON.stringify(quantizations),
  };
}

/** Existing code uses the provider's historical `Openrouter` spelling. */
export const parseOpenrouterQuantizations = parseOpenRouterQuantizations;
export type OpenrouterQuantization = OpenRouterQuantization;
export type OpenrouterQuantizationParseResult =
  OpenRouterQuantizationParseResult;
