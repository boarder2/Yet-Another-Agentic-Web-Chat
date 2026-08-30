import { describe, expect, it } from 'vitest';
import {
  isValidWorkspaceModelOverride,
  parseWorkspaceModelOverride,
  workspaceModelOverrideRefs,
} from './types';

const baseOverride = () => ({
  chatProvider: 'openai',
  chatModel: 'gpt-5.4',
  systemProvider: 'anthropic',
  systemModel: 'claude-opus-4-6',
  contextWindowSize: 8192,
});

describe('workspace model override reasoning contract', () => {
  it('preserves independent role effort and converts it to canonical refs', () => {
    const parsed = parseWorkspaceModelOverride({
      ...baseOverride(),
      chatReasoningEffort: 'high',
      systemReasoningEffort: 'low',
      imageCapable: true,
    });

    expect(parsed).toEqual({
      ...baseOverride(),
      chatReasoningEffort: 'high',
      systemReasoningEffort: 'low',
      imageCapable: true,
    });
    expect(workspaceModelOverrideRefs(parsed)).toEqual({
      chatModel: {
        provider: 'openai',
        name: 'gpt-5.4',
        contextWindowSize: 8192,
        reasoningEffort: 'high',
      },
      systemModel: {
        provider: 'anthropic',
        name: 'claude-opus-4-6',
        contextWindowSize: 8192,
        reasoningEffort: 'low',
      },
    });
  });

  it('keeps old flattened overrides valid and omits Provider default fields', () => {
    const parsed = parseWorkspaceModelOverride(baseOverride());
    const refs = workspaceModelOverrideRefs(parsed);

    expect(isValidWorkspaceModelOverride(parsed)).toBe(true);
    expect(parsed).not.toHaveProperty('chatReasoningEffort');
    expect(parsed).not.toHaveProperty('systemReasoningEffort');
    expect(refs.chatModel).not.toHaveProperty('reasoningEffort');
    expect(refs.systemModel).not.toHaveProperty('reasoningEffort');
  });

  it.each([
    ['chatReasoningEffort', { chatReasoningEffort: 'default' }],
    ['systemReasoningEffort', { systemReasoningEffort: null }],
    ['unknown field', { effort: 'high' }],
    ['empty chat model', { chatModel: '' }],
    ['non-integer context window', { contextWindowSize: 8192.5 }],
  ])('rejects malformed %s without coercion', (_name, extra) => {
    expect(() =>
      parseWorkspaceModelOverride({ ...baseOverride(), ...extra }),
    ).toThrow(/Invalid workspace model override/);
    expect(isValidWorkspaceModelOverride({ ...baseOverride(), ...extra })).toBe(
      false,
    );
  });
});
