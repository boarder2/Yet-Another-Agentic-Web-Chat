import { z } from 'zod';
import type { ModelRef } from '@/lib/providers/resolveModels';

/** The only durable agent-run configuration format currently supported. */
export const AGENT_RUN_CONFIG_VERSION = 1 as const;

/** Canonical model identity persisted with a continuable run. */
export const agentModelRefSchema = z
  .object({
    provider: z.string().min(1),
    name: z.string().min(1),
    contextWindowSize: z.number().int().positive().optional(),
  })
  .strict();

export type AgentModelRef = z.infer<typeof agentModelRefSchema>;

const panelExecutorSchema = agentModelRefSchema
  .extend({
    imageCapable: z.boolean().optional(),
  })
  .strict();

/** Strict representation of the panel settings carried by a run snapshot. */
export const agentPanelConfigSchema = z
  .object({
    executors: z.array(panelExecutorSchema).min(2).max(4),
    options: z.object({}).strict().optional(),
  })
  .strict();

export type AgentPanelConfig = z.infer<typeof agentPanelConfigSchema>;

const agentRunConfigBaseSchema = z
  .object({
    version: z.literal(AGENT_RUN_CONFIG_VERSION),
    chatModelRef: agentModelRefSchema,
    systemModelRef: agentModelRefSchema.nullable(),
    focusMode: z.string().min(1),
    fileIds: z.array(z.string().min(1)),
    personaInstructions: z.string(),
    methodologyInstructions: z.string(),
    userLocation: z.string().nullable(),
    userProfile: z.string().nullable(),
    workspaceId: z.string().min(1).nullable(),
    isPrivate: z.boolean(),
    chatId: z.string().min(1).nullable(),
    messageId: z.string().min(1).nullable(),
    aiMessageId: z.string().min(1).nullable(),
    interactiveSession: z.boolean(),
    workspaceSuffix: z.string(),
    memoryEnabled: z.boolean(),
    panel: agentPanelConfigSchema.nullable(),
    /** Effective mapping availability captured when the run was created. */
    mappingAvailable: z.boolean().optional(),
    /** Saved-location provider consent captured for this run. */
    mappingSavedLocationEnabled: z.boolean().optional(),
    /** Non-secret provider-configuration identity used to fail stale resumes safely. */
    mappingConfigHash: z.string().min(1).max(2_000).optional(),
  })
  .strict();

/**
 * A run config is also the persisted resume snapshot. Live dependencies,
 * signals, memory text, invoked skill bodies/names, and secrets are deliberately
 * not represented here.
 */
export const agentRunConfigSchema = agentRunConfigBaseSchema.superRefine(
  (config, ctx) => {
    if (!config.interactiveSession) return;

    for (const field of ['chatId', 'messageId', 'aiMessageId'] as const) {
      if (!config[field]) {
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: `${field} is required for a continuable run`,
        });
      }
    }
  },
);

export type AgentRunConfig = z.infer<typeof agentRunConfigSchema>;
export type AgentRunConfigInput = Omit<AgentRunConfig, 'version'>;

/** The resolver's model-ref shape remains the canonical caller-facing type. */
export type { ModelRef };

export class AgentRunConfigError extends Error {
  readonly issues?: z.ZodIssue[];

  constructor(message: string, issues?: z.ZodIssue[]) {
    super(message);
    this.name = 'AgentRunConfigError';
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeIssues(issues: z.ZodIssue[]): string {
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'snapshot';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

/** Decode and strictly validate a durable snapshot from the database. */
export function decodeAgentRunConfig(snapshot: unknown): AgentRunConfig {
  if (!isRecord(snapshot)) {
    throw new AgentRunConfigError('Agent run config snapshot is malformed.');
  }
  if (!Object.prototype.hasOwnProperty.call(snapshot, 'version')) {
    throw new AgentRunConfigError(
      'Agent run config snapshot is unversioned and cannot be resumed.',
    );
  }
  if (snapshot.version !== AGENT_RUN_CONFIG_VERSION) {
    throw new AgentRunConfigError(
      `Unsupported agent run config snapshot version: ${String(snapshot.version)}.`,
    );
  }

  const parsed = agentRunConfigSchema.safeParse(snapshot);
  if (!parsed.success) {
    throw new AgentRunConfigError(
      `Agent run config snapshot is invalid: ${describeIssues(parsed.error.issues)}`,
      parsed.error.issues,
    );
  }
  const config = parsed.data;
  // Keep old version-1 snapshots behaviorally explicit without changing their
  // serialized shape. New mapping-enabled runs provide enumerable fields;
  // missing legacy fields are non-enumerable false defaults.
  const defaults: PropertyDescriptorMap = {};
  if (!Object.prototype.hasOwnProperty.call(config, 'mappingAvailable')) {
    defaults.mappingAvailable = {
      value: false,
      writable: true,
      configurable: true,
    };
  }
  if (
    !Object.prototype.hasOwnProperty.call(config, 'mappingSavedLocationEnabled')
  ) {
    defaults.mappingSavedLocationEnabled = {
      value: false,
      writable: true,
      configurable: true,
    };
  }
  if (Object.keys(defaults).length > 0)
    Object.defineProperties(config, defaults);
  return config;
}

/**
 * Validate the config used to construct an agent and return its versioned,
 * database-safe representation. Callers should persist this returned value,
 * not rebuild a second snapshot from individual fields.
 */
export function createAgentRunConfig(
  input: AgentRunConfigInput,
): AgentRunConfig {
  return decodeAgentRunConfig({
    version: AGENT_RUN_CONFIG_VERSION,
    ...input,
  });
}

/** Encode a config for the JSON database column after strict validation. */
export function encodeAgentRunConfig(config: AgentRunConfig): AgentRunConfig {
  return decodeAgentRunConfig(config);
}

/** Missing fields in legacy version-1 snapshots mean mapping is disabled. */
export function isMappingAvailableInRun(config: AgentRunConfig): boolean {
  return config.mappingAvailable === true;
}

export function isSavedMappingLocationEnabledInRun(
  config: AgentRunConfig,
): boolean {
  return config.mappingSavedLocationEnabled === true;
}

export const agentRunConfigCodec = {
  encode: encodeAgentRunConfig,
  decode: decodeAgentRunConfig,
};
