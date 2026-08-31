import { z } from 'zod';
import {
  modelRefSchema,
  withoutReasoningEffort,
  type ModelRefContract,
  type ReasoningEffort,
} from '@/lib/providers/reasoningEffort';
import type { ModelRef } from '@/lib/providers/resolveModels';

/** The current durable agent-run configuration format. */
export const AGENT_RUN_CONFIG_VERSION = 2 as const;
export const LEGACY_AGENT_RUN_CONFIG_VERSION = 1 as const;

/** Canonical model identity persisted with a continuable run. */
export const agentModelRefSchema = modelRefSchema;
export type AgentModelRef = z.infer<typeof agentModelRefSchema>;
const legacyAgentModelRefSchema = modelRefSchema.omit({
  reasoningEffort: true,
});

const panelExecutorSchema = agentModelRefSchema
  .extend({
    imageCapable: z.boolean().optional(),
  })
  .strict();
const legacyPanelExecutorSchema = legacyAgentModelRefSchema
  .extend({
    imageCapable: z.boolean().optional(),
  })
  .strict();

/** Strict representation of panel settings carried by a v2 run snapshot. */
export const agentPanelConfigSchema = z
  .object({
    executors: z.array(panelExecutorSchema).min(2).max(4),
    options: z.object({}).strict().optional(),
  })
  .strict();

const legacyAgentPanelConfigSchema = z
  .object({
    executors: z.array(legacyPanelExecutorSchema).min(2).max(4),
    options: z.object({}).strict().optional(),
  })
  .strict();

export type AgentPanelConfig = z.infer<typeof agentPanelConfigSchema>;

const runConfigFields = {
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
};

const agentRunConfigBaseSchema = z
  .object({
    version: z.literal(AGENT_RUN_CONFIG_VERSION),
    chatModelRef: agentModelRefSchema,
    systemModelRef: agentModelRefSchema.nullable(),
    ...runConfigFields,
    panel: agentPanelConfigSchema.nullable(),
  })
  .strict();

const legacyAgentRunConfigSchema = z
  .object({
    version: z.literal(LEGACY_AGENT_RUN_CONFIG_VERSION),
    chatModelRef: legacyAgentModelRefSchema,
    systemModelRef: legacyAgentModelRefSchema.nullable(),
    ...runConfigFields,
    panel: legacyAgentPanelConfigSchema.nullable(),
  })
  .strict();

function validateInteractiveIdentity(
  config: {
    interactiveSession: boolean;
    chatId: string | null;
    messageId: string | null;
    aiMessageId: string | null;
  },
  ctx: z.core.$RefinementCtx,
): void {
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
}

export const agentRunConfigSchema = agentRunConfigBaseSchema.superRefine(
  validateInteractiveIdentity,
);
const legacyAgentRunConfigValidatedSchema =
  legacyAgentRunConfigSchema.superRefine(validateInteractiveIdentity);

/**
 * A run config is also the persisted resume snapshot. Live dependencies,
 * signals, memory text, invoked skill bodies/names, and secrets are deliberately
 * not represented here.
 */
export type AgentRunConfig = z.infer<typeof agentRunConfigSchema>;
export type AgentRunConfigInput = Omit<AgentRunConfig, 'version'>;

/** The resolver's model-ref shape remains the canonical caller-facing type. */
export type { ModelRef, ModelRefContract };

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

function invalidSnapshot(parsed: {
  success: false;
  error: z.ZodError;
}): AgentRunConfigError {
  return new AgentRunConfigError(
    `Agent run config snapshot is invalid: ${describeIssues(parsed.error.issues)}`,
    parsed.error.issues,
  );
}

function migrateLegacyModelRef(
  ref: z.infer<typeof legacyAgentModelRefSchema>,
): z.infer<typeof agentModelRefSchema> {
  return withoutReasoningEffort(ref) as z.infer<typeof agentModelRefSchema>;
}

function migrateLegacySnapshot(
  snapshot: unknown,
): AgentRunConfig | AgentRunConfigError {
  const parsed = legacyAgentRunConfigValidatedSchema.safeParse(snapshot);
  if (!parsed.success) return invalidSnapshot(parsed);

  const legacy = parsed.data;
  return {
    ...legacy,
    version: AGENT_RUN_CONFIG_VERSION,
    chatModelRef: migrateLegacyModelRef(legacy.chatModelRef),
    systemModelRef: legacy.systemModelRef
      ? migrateLegacyModelRef(legacy.systemModelRef)
      : null,
    panel: legacy.panel
      ? {
          ...legacy.panel,
          executors: legacy.panel.executors.map((executor) => ({
            ...executor,
            ...migrateLegacyModelRef(executor),
          })),
        }
      : null,
  } as AgentRunConfig;
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

  if (snapshot.version === LEGACY_AGENT_RUN_CONFIG_VERSION) {
    const migrated = migrateLegacySnapshot(snapshot);
    if (migrated instanceof AgentRunConfigError) throw migrated;
    return migrated;
  }
  if (snapshot.version !== AGENT_RUN_CONFIG_VERSION) {
    throw new AgentRunConfigError(
      `Unsupported agent run config snapshot version: ${String(snapshot.version)}.`,
    );
  }

  const parsed = agentRunConfigSchema.safeParse(snapshot);
  if (!parsed.success) throw invalidSnapshot(parsed);
  return parsed.data;
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
    ...input,
    version: AGENT_RUN_CONFIG_VERSION,
  });
}

/** Encode a config for the JSON database column after strict validation. */
export function encodeAgentRunConfig(config: AgentRunConfig): AgentRunConfig {
  return decodeAgentRunConfig(config);
}

/** The compact model identity retained in completed assistant metadata. */
export interface AgentModelAuditRef {
  provider: string;
  name: string;
  reasoningEffort?: ReasoningEffort;
}

export interface AgentModelConfigAudit {
  chat: AgentModelAuditRef;
  system: AgentModelAuditRef;
  panel?: { executors: AgentModelAuditRef[] };
}

function auditModelRef(ref: ModelRef): AgentModelAuditRef {
  return {
    provider: ref.provider,
    name: ref.name,
    ...(ref.reasoningEffort ? { reasoningEffort: ref.reasoningEffort } : {}),
  };
}

/** Build the effective role/executor model metadata for a completed turn. */
export function buildAgentModelConfigAudit(
  config: AgentRunConfig,
): AgentModelConfigAudit {
  return {
    chat: auditModelRef(config.chatModelRef),
    // Runtime resolution falls back to Chat when the durable System ref is null.
    system: auditModelRef(config.systemModelRef ?? config.chatModelRef),
    ...(config.panel
      ? {
          panel: {
            executors: config.panel.executors.map(auditModelRef),
          },
        }
      : {}),
  };
}

export const buildEffectiveModelConfig = buildAgentModelConfigAudit;

export const agentRunConfigCodec = {
  encode: encodeAgentRunConfig,
  decode: decodeAgentRunConfig,
};
