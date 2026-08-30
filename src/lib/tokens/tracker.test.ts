import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import { onStreamEvent, type ModelStatsV2 } from '@/lib/streaming/events';
import {
  TokenTracker,
  normalizeUsageMetadata,
  createTurnTracker,
} from './tracker';

function usage(input: number, output: number) {
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: input + output,
  };
}

describe('normalizeUsageMetadata', () => {
  it('handles the canonical input_tokens/output_tokens shape', () => {
    expect(
      normalizeUsageMetadata({ input_tokens: 10, output_tokens: 5 }),
    ).toEqual({
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
    });
  });

  it('falls back through provider-specific field names', () => {
    expect(
      normalizeUsageMetadata({
        prompt_tokens: 3,
        completion_tokens: 2,
        total_tokens: 5,
      }),
    ).toEqual({ input_tokens: 3, output_tokens: 2, total_tokens: 5 });
  });
});

describe('TokenTracker', () => {
  it('accumulates usage across multiple record() calls on one recorder', () => {
    const tracker = new TokenTracker(new EventEmitter());
    const rec = tracker.register({
      provider: 'openai',
      model: 'gpt-5',
      role: 'chat',
    });
    rec.record(usage(10, 5));
    rec.record(usage(20, 10));
    expect(tracker.perModel()).toEqual([
      { provider: 'openai', model: 'gpt-5', usage: usage(30, 15) },
    ]);
  });

  it('merges the same (provider, model) recorded across different scopes and roles', () => {
    const tracker = new TokenTracker(new EventEmitter());
    const root = tracker.register({
      provider: 'openai',
      model: 'gpt-5',
      role: 'chat',
    });
    const executor = tracker.register({
      provider: 'openai',
      model: 'gpt-5',
      role: 'chat',
      scope: 'panel_executor:0',
    });
    root.record(usage(10, 5));
    executor.record(usage(1, 1));
    expect(tracker.perModel()).toEqual([
      { provider: 'openai', model: 'gpt-5', usage: usage(11, 6) },
    ]);
  });

  it('keeps same-named models from different providers as separate rows', () => {
    const tracker = new TokenTracker(new EventEmitter());
    const a = tracker.register({
      provider: 'openai',
      model: 'shared-name',
      role: 'chat',
    });
    const b = tracker.register({
      provider: 'anthropic',
      model: 'shared-name',
      role: 'system',
    });
    a.record(usage(5, 5));
    b.record(usage(3, 3));
    const rows = tracker.perModel();
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.provider === 'openai')).toEqual({
      provider: 'openai',
      model: 'shared-name',
      usage: usage(5, 5),
    });
    expect(rows.find((r) => r.provider === 'anthropic')).toEqual({
      provider: 'anthropic',
      model: 'shared-name',
      usage: usage(3, 3),
    });
  });

  it('orders the root chat model first, then by total tokens descending', () => {
    const tracker = new TokenTracker(new EventEmitter());
    const chat = tracker.register({
      provider: 'openai',
      model: 'gpt-5',
      role: 'chat',
    });
    const system = tracker.register({
      provider: 'openai',
      model: 'gpt-5-mini',
      role: 'system',
    });
    const big = tracker.register({
      provider: 'openai',
      model: 'gpt-5-huge',
      role: 'chat',
      scope: 'panel_executor:0',
    });
    // chat model has the smallest usage, but must still sort first.
    chat.record(usage(1, 1));
    system.record(usage(5, 5));
    big.record(usage(100, 100));
    expect(tracker.perModel().map((r) => r.model)).toEqual([
      'gpt-5',
      'gpt-5-huge',
      'gpt-5-mini',
    ]);
  });

  it('excludes registered-but-never-recorded models from perModel()', () => {
    const tracker = new TokenTracker(new EventEmitter());
    tracker.register({ provider: 'openai', model: 'unused', role: 'system' });
    const chat = tracker.register({
      provider: 'openai',
      model: 'gpt-5',
      role: 'chat',
    });
    chat.record(usage(1, 1));
    expect(tracker.perModel()).toEqual([
      { provider: 'openai', model: 'gpt-5', usage: usage(1, 1) },
    ]);
  });

  it('splits scopeUsage by role for the frozen PanelUsage shape', () => {
    const tracker = new TokenTracker(new EventEmitter());
    const executorChat = tracker.register({
      provider: 'openai',
      model: 'gpt-5',
      role: 'chat',
      scope: 'panel_executor:1',
    });
    const executorSystem = tracker.register({
      provider: 'openai',
      model: 'gpt-5-mini',
      role: 'system',
      scope: 'panel_executor:1',
    });
    const otherScope = tracker.register({
      provider: 'openai',
      model: 'gpt-5',
      role: 'chat',
      scope: 'panel_executor:2',
    });
    executorChat.record(usage(10, 10));
    executorSystem.record(usage(2, 2));
    otherScope.record(usage(999, 999));
    expect(tracker.scopeUsage('panel_executor:1')).toEqual({
      usageChat: usage(10, 10),
      usageSystem: usage(2, 2),
    });
  });

  it('captures firstChatCallInputTokens from the root chat recorder only', () => {
    const tracker = new TokenTracker(new EventEmitter());
    const chat = tracker.register({
      provider: 'openai',
      model: 'gpt-5',
      role: 'chat',
    });
    const executorChat = tracker.register({
      provider: 'openai',
      model: 'gpt-5-mini',
      role: 'chat',
      scope: 'panel_executor:0',
    });
    executorChat.record(usage(500, 1));
    expect(tracker.statsV2().firstChatCallInputTokens).toBe(0);
    chat.record(usage(42, 1));
    expect(tracker.statsV2().firstChatCallInputTokens).toBe(42);
    chat.record(usage(99, 1));
    expect(tracker.statsV2().firstChatCallInputTokens).toBe(42);
  });

  it('hydrates a cumulative baseline regardless of recorder registration order', () => {
    const baseline = {
      version: 2 as const,
      perModel: [
        { provider: 'anthropic', model: 'claude', usage: usage(30, 10) },
        { provider: 'openai', model: 'gpt-5', usage: usage(100, 20) },
      ],
      firstChatCallInputTokens: 100,
    };

    for (const seedFirst of [false, true]) {
      const tracker = new TokenTracker(new EventEmitter());
      if (seedFirst) tracker.seed(baseline);
      const chat = tracker.register({
        provider: 'openai',
        model: 'gpt-5',
        role: 'chat',
      });
      tracker.register({
        provider: 'anthropic',
        model: 'claude',
        role: 'system',
      });
      if (!seedFirst) tracker.seed(baseline);

      chat.record(usage(7, 3));

      expect(tracker.perModel()).toEqual([
        { provider: 'openai', model: 'gpt-5', usage: usage(107, 23) },
        { provider: 'anthropic', model: 'claude', usage: usage(30, 10) },
      ]);
      expect(tracker.statsV2().firstChatCallInputTokens).toBe(100);
    }
  });

  it('emits repeated cumulative resume snapshots without double-adding a repeated seed', () => {
    const emitter = new EventEmitter();
    const seen: ModelStatsV2[] = [];
    onStreamEvent(emitter, (event) => {
      if (event.type === 'model_stats') seen.push(event.data as ModelStatsV2);
    });

    const tracker = new TokenTracker(emitter);
    const chat = tracker.register({
      provider: 'openai',
      model: 'gpt-5',
      role: 'chat',
    });
    const baseline = {
      version: 2 as const,
      perModel: [{ provider: 'openai', model: 'gpt-5', usage: usage(10, 5) }],
      firstChatCallInputTokens: 10,
    };
    tracker.seed(baseline);
    tracker.seed(baseline);

    chat.record(usage(2, 1));
    chat.record(usage(4, 3));

    expect(seen.map((stats) => stats.perModel)).toEqual([
      [{ provider: 'openai', model: 'gpt-5', usage: usage(12, 6) }],
      [{ provider: 'openai', model: 'gpt-5', usage: usage(16, 9) }],
    ]);
    expect(seen.map((stats) => stats.firstChatCallInputTokens)).toEqual([
      10, 10,
    ]);
  });

  it('exposes the root-scope identity registered for a role', () => {
    const tracker = new TokenTracker(new EventEmitter());
    tracker.register({ provider: 'openai', model: 'gpt-5', role: 'chat' });
    tracker.register({
      provider: 'anthropic',
      model: 'claude',
      role: 'system',
    });
    tracker.register({
      provider: 'openai',
      model: 'gpt-5-mini',
      role: 'chat',
      scope: 'panel_executor:0',
    });
    expect(tracker.rootIdentity('chat')).toEqual({
      provider: 'openai',
      model: 'gpt-5',
    });
    expect(tracker.rootIdentity('system')).toEqual({
      provider: 'anthropic',
      model: 'claude',
    });
    expect(tracker.rootIdentity('image_gen')).toBeUndefined();
  });

  it('keeps role effort in root identity without changing token usage rows', () => {
    const tracker = new TokenTracker(new EventEmitter());
    const chat = tracker.register({
      provider: 'openai',
      model: 'gpt-5',
      reasoningEffort: 'high',
      role: 'chat',
    });
    const system = tracker.register({
      provider: 'anthropic',
      model: 'claude',
      reasoningEffort: 'low',
      role: 'system',
    });

    chat.record(usage(4, 2));
    system.record(usage(3, 1));

    expect(tracker.rootIdentity('chat')).toEqual({
      provider: 'openai',
      model: 'gpt-5',
      reasoningEffort: 'high',
    });
    expect(tracker.rootIdentity('system')).toEqual({
      provider: 'anthropic',
      model: 'claude',
      reasoningEffort: 'low',
    });
    expect(tracker.perModel()).toEqual([
      { provider: 'openai', model: 'gpt-5', usage: usage(4, 2) },
      { provider: 'anthropic', model: 'claude', usage: usage(3, 1) },
    ]);
  });

  it('emits a model_stats snapshot on every record() call', () => {
    const emitter = new EventEmitter();
    const seen: unknown[] = [];
    onStreamEvent(emitter, (event) => {
      if (event.type === 'model_stats') seen.push(event.data);
    });
    const tracker = new TokenTracker(emitter);
    const rec = tracker.register({
      provider: 'openai',
      model: 'gpt-5',
      role: 'chat',
    });
    rec.record(usage(1, 1));
    rec.record(usage(2, 2));
    expect(seen).toHaveLength(2);
    expect(seen[1]).toEqual({
      version: 2,
      perModel: [{ provider: 'openai', model: 'gpt-5', usage: usage(3, 3) }],
      firstChatCallInputTokens: 1,
    });
  });
});

describe('createTurnTracker', () => {
  it('registers root chat and system recorders from distinct model refs', () => {
    const { tracker, chatRecorder, systemRecorder } = createTurnTracker(
      new EventEmitter(),
      { provider: 'openai', name: 'gpt-5' },
      { provider: 'anthropic', name: 'claude' },
    );
    chatRecorder.record(usage(1, 1));
    systemRecorder.record(usage(2, 2));
    const rows = tracker.perModel();
    expect(rows).toEqual([
      { provider: 'openai', model: 'gpt-5', usage: usage(1, 1) },
      { provider: 'anthropic', model: 'claude', usage: usage(2, 2) },
    ]);
  });

  it('falls back the complete chat identity to the system recorder when absent', () => {
    const { tracker, chatRecorder, systemRecorder } = createTurnTracker(
      new EventEmitter(),
      { provider: 'openai', name: 'gpt-5', reasoningEffort: 'xhigh' },
      null,
    );
    chatRecorder.record(usage(1, 1));
    systemRecorder.record(usage(2, 2));
    expect(tracker.rootIdentity('system')).toEqual({
      provider: 'openai',
      model: 'gpt-5',
      reasoningEffort: 'xhigh',
    });
    expect(tracker.perModel()).toEqual([
      { provider: 'openai', model: 'gpt-5', usage: usage(3, 3) },
    ]);
  });
});
