import { describe, expect, it } from 'vitest';
import {
  OPENROUTER_QUANTIZATION_OPTIONS,
  OPENROUTER_QUANTIZATIONS,
  parseOpenRouterQuantizations,
} from './openrouterQuantizations';

describe('OpenRouter quantization contract', () => {
  it('exposes the fixed allow-list and grouped display metadata', () => {
    expect(OPENROUTER_QUANTIZATIONS).toEqual([
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
    ]);
    expect(
      OPENROUTER_QUANTIZATION_OPTIONS.map((option) => option.value),
    ).toEqual(OPENROUTER_QUANTIZATIONS);
    expect(
      OPENROUTER_QUANTIZATION_OPTIONS.filter(
        (option) => option.group === 'Integer',
      ).map((option) => option.value),
    ).toEqual(['int4', 'int8']);
    expect(
      OPENROUTER_QUANTIZATION_OPTIONS.filter(
        (option) => option.group === 'Floating point',
      ),
    ).toHaveLength(9);
  });

  it('treats missing and empty settings as the unrestricted default', () => {
    expect(parseOpenRouterQuantizations(undefined)).toEqual({
      valid: true,
      raw: null,
      quantizations: [],
      canonical: '[]',
    });
    expect(parseOpenRouterQuantizations(null)).toEqual({
      valid: true,
      raw: null,
      quantizations: [],
      canonical: '[]',
    });
    expect(parseOpenRouterQuantizations('[]')).toEqual({
      valid: true,
      raw: '[]',
      quantizations: [],
      canonical: '[]',
    });
  });

  it('returns supported values in contract order with canonical JSON', () => {
    expect(
      parseOpenRouterQuantizations(' ["fp32", "int4", "fp8", "int4"] '),
    ).toMatchObject({
      valid: false,
      raw: ' ["fp32", "int4", "fp8", "int4"] ',
      quantizations: null,
    });

    expect(
      parseOpenRouterQuantizations(' ["fp32", "int4", "fp8", "bf16"] '),
    ).toEqual({
      valid: true,
      raw: ' ["fp32", "int4", "fp8", "bf16"] ',
      quantizations: ['int4', 'fp8', 'bf16', 'fp32'],
      canonical: '["int4","fp8","bf16","fp32"]',
    });
  });

  it.each([
    ['malformed JSON', '{"quantizations":'],
    ['non-array JSON', '"fp8"'],
    ['object JSON', '{"0":"fp8"}'],
    ['unsupported value', '["int3"]'],
    ['duplicate value', '["fp8","fp8"]'],
    ['mixed invalid values', '["fp8",8]'],
  ])('fails closed for %s', (_label, raw) => {
    const result = parseOpenRouterQuantizations(raw);

    expect(result.valid).toBe(false);
    expect(result.raw).toBe(raw);
    expect(result.quantizations).toBeNull();
  });

  it.each([
    ['a JavaScript array', ['fp8']],
    ['a number', 8],
    ['an object', { value: 'fp8' }],
  ])('rejects directly supplied %s instead of sanitizing it', (_label, raw) => {
    const result = parseOpenRouterQuantizations(raw);

    expect(result.valid).toBe(false);
    expect(result.quantizations).toBeNull();
  });
});
