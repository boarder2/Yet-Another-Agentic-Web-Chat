import {
  parseReasoningEffort,
  type ReasoningEffort,
} from '@/lib/providers/reasoningEffort';
import type { ModelRef } from '@/lib/providers/resolveModels';

export interface WorkspaceModelOverride {
  chatProvider: string;
  chatModel: string;
  systemProvider: string;
  systemModel: string;
  imageCapable?: boolean;
  contextWindowSize?: number;
  /** Omitted means Provider default for the respective role. */
  chatReasoningEffort?: ReasoningEffort;
  systemReasoningEffort?: ReasoningEffort;
}

/** Parse a workspace's flattened model override without coercion. */
export function parseWorkspaceModelOverride(
  value: unknown,
): WorkspaceModelOverride {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Invalid workspace model override.');
  }
  const raw = value as Record<string, unknown>;
  const allowedKeys = new Set([
    'chatProvider',
    'chatModel',
    'systemProvider',
    'systemModel',
    'imageCapable',
    'contextWindowSize',
    'chatReasoningEffort',
    'systemReasoningEffort',
  ]);
  const unexpected = Object.keys(raw).find((key) => !allowedKeys.has(key));
  if (unexpected) {
    throw new Error(
      `Invalid workspace model override: unexpected field ${unexpected}.`,
    );
  }
  for (const key of [
    'chatProvider',
    'chatModel',
    'systemProvider',
    'systemModel',
  ]) {
    if (typeof raw[key] !== 'string' || (raw[key] as string).length === 0) {
      throw new Error(`Invalid workspace model override: ${key} is required.`);
    }
  }
  if (raw.imageCapable !== undefined && typeof raw.imageCapable !== 'boolean') {
    throw new Error(
      'Invalid workspace model override: imageCapable must be a boolean.',
    );
  }
  if (
    raw.contextWindowSize !== undefined &&
    (typeof raw.contextWindowSize !== 'number' ||
      !Number.isInteger(raw.contextWindowSize) ||
      raw.contextWindowSize <= 0)
  ) {
    throw new Error(
      'Invalid workspace model override: contextWindowSize must be a positive integer.',
    );
  }

  let chatReasoningEffort: ReasoningEffort | undefined;
  let systemReasoningEffort: ReasoningEffort | undefined;
  try {
    chatReasoningEffort = parseReasoningEffort(raw.chatReasoningEffort);
    systemReasoningEffort = parseReasoningEffort(raw.systemReasoningEffort);
  } catch (error) {
    throw new Error(
      `Invalid workspace model override: ${error instanceof Error ? error.message : 'invalid reasoning effort'}`,
    );
  }

  return {
    chatProvider: raw.chatProvider as string,
    chatModel: raw.chatModel as string,
    systemProvider: raw.systemProvider as string,
    systemModel: raw.systemModel as string,
    ...(raw.imageCapable !== undefined
      ? { imageCapable: raw.imageCapable as boolean }
      : {}),
    ...(raw.contextWindowSize !== undefined
      ? { contextWindowSize: raw.contextWindowSize as number }
      : {}),
    ...(chatReasoningEffort ? { chatReasoningEffort } : {}),
    ...(systemReasoningEffort ? { systemReasoningEffort } : {}),
  };
}

export function isValidWorkspaceModelOverride(
  value: unknown,
): value is WorkspaceModelOverride {
  try {
    parseWorkspaceModelOverride(value);
    return true;
  } catch {
    return false;
  }
}

/** Convert the flattened workspace representation to canonical model refs. */
export function workspaceModelOverrideRefs(override: WorkspaceModelOverride): {
  chatModel: ModelRef;
  systemModel: ModelRef;
} {
  return {
    chatModel: {
      provider: override.chatProvider,
      name: override.chatModel,
      ...(override.contextWindowSize !== undefined
        ? { contextWindowSize: override.contextWindowSize }
        : {}),
      ...(override.chatReasoningEffort
        ? { reasoningEffort: override.chatReasoningEffort }
        : {}),
    },
    systemModel: {
      provider: override.systemProvider,
      name: override.systemModel,
      ...(override.contextWindowSize !== undefined
        ? { contextWindowSize: override.contextWindowSize }
        : {}),
      ...(override.systemReasoningEffort
        ? { reasoningEffort: override.systemReasoningEffort }
        : {}),
    },
  };
}

/** Shown (server error + composer banner) when a workspace's pinned model no
 * longer resolves against the live provider catalog. */
export const WORKSPACE_MODEL_UNAVAILABLE_MESSAGE =
  "This workspace's pinned model is no longer available. Update it in workspace settings.";

export class WorkspaceInputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceInputValidationError';
  }
}

export interface WorkspaceCreate {
  name: string;
  description?: string;
  color?: string;
  icon?: string;
  instructions?: string;
  autoMemoryEnabled?: 0 | 1 | null;
  autoAcceptFileEdits?: 0 | 1;
  modelOverride?: WorkspaceModelOverride | null;
}

export type WorkspaceUpdate = Partial<WorkspaceCreate>;
