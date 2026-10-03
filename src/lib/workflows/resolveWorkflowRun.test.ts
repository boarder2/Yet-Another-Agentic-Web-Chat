import { describe, expect, it } from 'vitest';
import { ModelReferenceValidationError } from '@/lib/providers/resolveModels';
import { resolveWorkflowRun, type Workflow } from './resolveWorkflowRun';

const workflow = (overrides: Record<string, unknown> = {}): Workflow =>
  ({
    id: 'workflow-1',
    name: 'Research workflow',
    description: null,
    icon: null,
    prompt: 'Research {{topic}}',
    focusMode: 'webSearch',
    chatModel: { provider: 'openai', name: 'gpt-5.4' },
    systemModel: null,
    selectedSystemPromptIds: [],
    selectedMethodologyId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as Workflow;

const CLOCK = { now: '2026-07-22T14:30:00Z', timeZone: 'UTC' };

describe('resolveWorkflowRun model references', () => {
  it('retains configured Chat/System effort in the run input', () => {
    const resolved = resolveWorkflowRun(
      workflow({
        chatModel: {
          provider: 'openai',
          name: 'gpt-5.4',
          reasoningEffort: 'high',
        },
        systemModel: {
          provider: 'anthropic',
          name: 'claude-opus-4-6',
          reasoningEffort: 'low',
        },
      }),
      { topic: 'durable runtime' },
      CLOCK,
    );

    expect(resolved.chatModel).toEqual({
      provider: 'openai',
      name: 'gpt-5.4',
      reasoningEffort: 'high',
    });
    expect(resolved.systemModel).toEqual({
      provider: 'anthropic',
      name: 'claude-opus-4-6',
      reasoningEffort: 'low',
    });
  });

  it('keeps legacy workflows at Provider default', () => {
    const resolved = resolveWorkflowRun(
      workflow(),
      { topic: 'legacy workflow' },
      CLOCK,
    );

    expect(resolved.chatModel).not.toHaveProperty('reasoningEffort');
    expect(resolved.systemModel).toBeNull();
  });

  it('rejects malformed durable model references before a run is started', () => {
    expect(() =>
      resolveWorkflowRun(
        workflow({
          chatModel: {
            provider: 'openai',
            name: 'gpt-5.4',
            reasoningEffort: 'default',
          },
        }),
        { topic: 'invalid' },
        CLOCK,
      ),
    ).toThrow(ModelReferenceValidationError);
  });
});
