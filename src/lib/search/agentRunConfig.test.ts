import { describe, expect, it } from 'vitest';
import {
  AGENT_RUN_CONFIG_VERSION,
  LEGACY_AGENT_RUN_CONFIG_VERSION,
  AgentRunConfigError,
  agentRunConfigCodec,
  buildAgentModelConfigAudit,
  createAgentRunConfig,
  decodeAgentRunConfig,
  encodeAgentRunConfig,
  type AgentRunConfig,
  type AgentRunConfigInput,
} from './agentRunConfig';

const validInput = (): AgentRunConfigInput => ({
  chatModelRef: {
    provider: 'openai',
    name: 'gpt-5',
    contextWindowSize: 128_000,
  },
  systemModelRef: {
    provider: 'anthropic',
    name: 'claude-sonnet',
    contextWindowSize: 200_000,
  },
  focusMode: 'webSearch',
  fileIds: ['file-1', 'file-2'],
  personaInstructions: 'Answer in a direct style.',
  methodologyInstructions: 'Cite primary sources.',
  userLocation: 'Berlin',
  userProfile: 'Researcher',
  workspaceId: 'workspace-1',
  isPrivate: false,
  chatId: 'chat-1',
  messageId: 'message-1',
  aiMessageId: 'assistant-1',
  interactiveSession: true,
  workspaceSuffix: '\nWorkspace instructions',
  memoryEnabled: true,
  panel: {
    executors: [
      { provider: 'openai', name: 'gpt-5-mini', imageCapable: true },
      { provider: 'anthropic', name: 'claude-haiku' },
    ],
    options: {},
  },
});

const validConfig = (): AgentRunConfig => createAgentRunConfig(validInput());

const snapshotWith = (overrides: Record<string, unknown>): unknown => ({
  ...validConfig(),
  ...overrides,
});

describe('agent run config codec', () => {
  it('creates a versioned config and round-trips it through JSON persistence', () => {
    const config = validConfig();
    const encoded = encodeAgentRunConfig(config);
    const persisted = JSON.parse(JSON.stringify(encoded)) as unknown;

    expect(encoded).toEqual({ ...config, version: AGENT_RUN_CONFIG_VERSION });
    expect(agentRunConfigCodec.decode(persisted)).toEqual(config);
  });

  it('preserves nullable system model and non-continuable identity fields', () => {
    const config = createAgentRunConfig({
      ...validInput(),
      systemModelRef: null,
      chatId: null,
      messageId: null,
      aiMessageId: null,
      interactiveSession: false,
      panel: null,
    });

    expect(config.systemModelRef).toBeNull();
    expect(config.chatId).toBeNull();
    expect(config.messageId).toBeNull();
    expect(config.aiMessageId).toBeNull();
    expect(config.interactiveSession).toBe(false);
  });

  it('round-trips resolved role and panel effort in the v2 snapshot', () => {
    const config = createAgentRunConfig({
      ...validInput(),
      chatModelRef: {
        ...validInput().chatModelRef,
        reasoningEffort: 'high',
      },
      systemModelRef: {
        ...validInput().systemModelRef!,
        reasoningEffort: 'low',
      },
      panel: {
        executors: [
          {
            provider: 'openai',
            name: 'gpt-5-mini',
            reasoningEffort: 'medium',
            imageCapable: true,
          },
          {
            provider: 'anthropic',
            name: 'claude-haiku',
            reasoningEffort: 'off',
          },
        ],
        options: {},
      },
    });

    expect(config.version).toBe(AGENT_RUN_CONFIG_VERSION);
    expect(
      agentRunConfigCodec.decode(JSON.parse(JSON.stringify(config))),
    ).toEqual(config);
    expect(buildAgentModelConfigAudit(config)).toEqual({
      chat: { provider: 'openai', name: 'gpt-5', reasoningEffort: 'high' },
      system: {
        provider: 'anthropic',
        name: 'claude-sonnet',
        reasoningEffort: 'low',
      },
      panel: {
        executors: [
          {
            provider: 'openai',
            name: 'gpt-5-mini',
            reasoningEffort: 'medium',
          },
          {
            provider: 'anthropic',
            name: 'claude-haiku',
            reasoningEffort: 'off',
          },
        ],
      },
    });
  });

  it('migrates v1 snapshots to v2 with Provider default omitted', () => {
    const legacy = {
      ...validConfig(),
      version: LEGACY_AGENT_RUN_CONFIG_VERSION,
    };

    const migrated = decodeAgentRunConfig(legacy);

    expect(migrated).toEqual({
      ...validConfig(),
      version: AGENT_RUN_CONFIG_VERSION,
    });
    expect(migrated.chatModelRef).not.toHaveProperty('reasoningEffort');
    expect(migrated.systemModelRef).not.toHaveProperty('reasoningEffort');
    expect(migrated.panel?.executors[0]).not.toHaveProperty('reasoningEffort');
  });

  it('uses the chat reference for both audited roles when system is omitted', () => {
    const config = createAgentRunConfig({
      ...validInput(),
      chatModelRef: {
        provider: 'openai',
        name: 'gpt-5',
        reasoningEffort: 'xhigh',
      },
      systemModelRef: null,
      panel: null,
    });

    expect(buildAgentModelConfigAudit(config)).toEqual({
      chat: { provider: 'openai', name: 'gpt-5', reasoningEffort: 'xhigh' },
      system: { provider: 'openai', name: 'gpt-5', reasoningEffort: 'xhigh' },
    });
  });

  it('persists only the current non-sensitive configuration fields', () => {
    const config = validConfig();

    expect(Object.keys(config).sort()).toEqual(
      [
        'aiMessageId',
        'chatId',
        'chatModelRef',
        'fileIds',
        'focusMode',
        'interactiveSession',
        'isPrivate',
        'memoryEnabled',
        'messageId',
        'methodologyInstructions',
        'panel',
        'personaInstructions',
        'systemModelRef',
        'userLocation',
        'userProfile',
        'version',
        'workspaceId',
        'workspaceSuffix',
      ].sort(),
    );

    const serialized = JSON.stringify(config);
    for (const excluded of [
      'memorySection',
      'invokedSkillNames',
      'signal',
      'retrievalSignal',
      'threadId',
      'activeRunThreadId',
      'chatLlm',
      'systemLlm',
      'embeddings',
      'tokenTracking',
      'secret',
    ]) {
      expect(serialized).not.toContain(excluded);
    }
  });

  it('rejects unknown root fields instead of silently dropping them', () => {
    expect(() =>
      decodeAgentRunConfig(snapshotWith({ unexpected: true })),
    ).toThrow(AgentRunConfigError);
    expect(() =>
      decodeAgentRunConfig(snapshotWith({ unexpected: true })),
    ).toThrow(/unexpected/);
  });

  it.each([
    {
      name: 'a model ref using the legacy model key',
      snapshot: () =>
        snapshotWith({
          chatModelRef: { provider: 'openai', model: 'gpt-5' },
        }),
    },
    {
      name: 'an invalid model context window',
      snapshot: () =>
        snapshotWith({
          chatModelRef: {
            provider: 'openai',
            name: 'gpt-5',
            contextWindowSize: 0,
          },
        }),
    },
    {
      name: 'an executor outside the panel cardinality bounds',
      snapshot: () =>
        snapshotWith({
          panel: {
            executors: [{ provider: 'openai', name: 'gpt-5' }],
          },
        }),
    },
    {
      name: 'an unknown panel executor field',
      snapshot: () =>
        snapshotWith({
          panel: {
            executors: [
              { provider: 'openai', name: 'gpt-5', unexpected: true },
              { provider: 'anthropic', name: 'claude' },
            ],
          },
        }),
    },
    {
      name: 'an unknown panel options field',
      snapshot: () =>
        snapshotWith({
          panel: {
            executors: [
              { provider: 'openai', name: 'gpt-5' },
              { provider: 'anthropic', name: 'claude' },
            ],
            options: { concurrency: 2 },
          },
        }),
    },
  ])('rejects $name', ({ snapshot }) => {
    expect(() => decodeAgentRunConfig(snapshot())).toThrow(AgentRunConfigError);
  });

  it('requires all durable identities for an interactive run', () => {
    for (const field of ['chatId', 'messageId', 'aiMessageId'] as const) {
      const input = validInput();
      input[field] = null;

      expect(() => createAgentRunConfig(input)).toThrow(
        new RegExp(`${field}.*required for a continuable run`),
      );
    }
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['an array', []],
    ['a string', 'snapshot'],
    ['an unversioned object', { ...validConfig(), version: undefined }],
    ['an unsupported version', { ...validConfig(), version: 99 }],
  ])('rejects %s snapshots as explicit codec errors', (_name, snapshot) => {
    expect(() => decodeAgentRunConfig(snapshot)).toThrow(AgentRunConfigError);
  });

  it('distinguishes unversioned and unsupported snapshots', () => {
    const unversioned = { ...validConfig() } as Record<string, unknown>;
    delete unversioned.version;

    expect(() => decodeAgentRunConfig(unversioned)).toThrow(
      /unversioned.*cannot be resumed/,
    );
    expect(() =>
      decodeAgentRunConfig({ ...validConfig(), version: 99 }),
    ).toThrow(/Unsupported agent run config snapshot version/);
  });

  it('rejects malformed values rather than coercing them', () => {
    expect(() =>
      decodeAgentRunConfig(
        snapshotWith({
          focusMode: '',
          fileIds: [''],
          isPrivate: 'false',
        }),
      ),
    ).toThrow(/snapshot is invalid/);
  });
});
