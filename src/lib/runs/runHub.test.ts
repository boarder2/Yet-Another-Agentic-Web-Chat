import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { evictByChatId, getRun, startRun } from './runHub';
import type { AgentRunConfig } from '@/lib/search/agentRunConfig';

const snapshot = (): AgentRunConfig =>
  ({
    version: 2,
    chatModelRef: {
      provider: 'openai',
      name: 'gpt-5.4',
      reasoningEffort: 'high',
    },
    systemModelRef: {
      provider: 'anthropic',
      name: 'claude-opus-4-6',
      reasoningEffort: 'low',
    },
    focusMode: 'webSearch',
    fileIds: [],
    personaInstructions: '',
    methodologyInstructions: '',
    userLocation: null,
    userProfile: null,
    workspaceId: null,
    isPrivate: false,
    chatId: 'chat-snapshot',
    messageId: 'message-snapshot',
    aiMessageId: 'assistant-snapshot',
    interactiveSession: true,
    workspaceSuffix: '',
    memoryEnabled: false,
    panel: {
      executors: [
        { provider: 'openai', name: 'gpt-5-mini', reasoningEffort: 'medium' },
        { provider: 'groq', name: 'qwen/qwen3.8-27b', reasoningEffort: 'off' },
      ],
    },
  }) as AgentRunConfig;

const started = new Set<string>();

afterEach(() => {
  for (const chatId of started) evictByChatId(chatId);
  started.clear();
});

describe('run hub durable configuration snapshot', () => {
  it('retains the effective v2 snapshot for idempotent re-subscription', () => {
    const chatId = `chat-${randomUUID()}`;
    const messageId = `message-${randomUUID()}`;
    started.add(chatId);
    const config = snapshot();

    const first = startRun({
      chatId,
      messageId,
      aiMessageId: `assistant-${randomUUID()}`,
      threadId: `${messageId}:1`,
      emitter: new EventEmitter(),
      abortController: new AbortController(),
      retrievalController: new AbortController(),
      configSnapshot: config,
    });
    const second = startRun({
      chatId,
      messageId,
      aiMessageId: `assistant-${randomUUID()}`,
      threadId: `${messageId}:2`,
      emitter: new EventEmitter(),
      abortController: new AbortController(),
      retrievalController: new AbortController(),
      configSnapshot: snapshot(),
    });

    expect(first.isNew).toBe(true);
    expect(first.run.configSnapshot).toBe(config);
    expect(second).toEqual({ run: first.run, isNew: false });
    expect(getRun(messageId)?.configSnapshot).toBe(config);
  });
});
