import { z } from 'zod';

export const CAPABILITY_AVAILABILITY_STATUSES = [
  'available',
  'disabled',
  'not configured',
  'unknown on this device',
] as const;

export type CapabilityAvailabilityStatus =
  (typeof CAPABILITY_AVAILABILITY_STATUSES)[number];

/**
 * Only non-sensitive, already-known facts may cross the tool boundary. This is
 * the single declaration; `toolContext` validates against this same schema.
 */
export const capabilityRuntimeFactsSchema = z.object({
  focusMode: z.string().optional(),
  isPrivate: z.boolean().optional(),
  hasFiles: z.boolean().optional(),
  hasWorkspace: z.boolean().optional(),
  memoryEnabled: z.boolean().optional(),
  interactiveSession: z.boolean().optional(),
  hasDurableChat: z.boolean().optional(),
  hasPersonalization: z.boolean().optional(),
  codeExecutionConfigured: z.boolean().optional(),
  codeExecutionEnabled: z.boolean().optional(),
  imageGenerationConfigured: z.boolean().optional(),
  imageGenerationEnabled: z.boolean().optional(),
  searchCapabilities: z
    .object({
      web: z.boolean().optional(),
      images: z.boolean().optional(),
      videos: z.boolean().optional(),
      autocomplete: z.boolean().optional(),
    })
    .optional(),
});

export type CapabilityRuntimeFacts = z.infer<
  typeof capabilityRuntimeFactsSchema
>;

export interface CapabilityAvailability {
  capability: string;
  status: CapabilityAvailabilityStatus;
}

const UNKNOWN_CAPABILITY = 'unknown capability';

function safeCapabilityLabel(value: string): string {
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (
    !normalized ||
    normalized.length > 100 ||
    normalized.includes('/') ||
    normalized.includes('\\') ||
    normalized.includes('..')
  ) {
    return UNKNOWN_CAPABILITY;
  }
  return normalized.replace(/\s+/g, ' ');
}

function capabilityKey(value: string): string {
  return value
    .toLocaleLowerCase()
    .trim()
    .replace(/[_.-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

/** An unset fact is never asserted as a negative; it stays unknown. */
function tristate(
  value: boolean | undefined,
  whenFalse: 'disabled' | 'not configured',
): CapabilityAvailabilityStatus {
  if (value === true) return 'available';
  if (value === false) return whenFalse;
  return 'unknown on this device';
}

function isWebFocus(focusMode: string | undefined): boolean {
  return focusMode === undefined || focusMode === 'webSearch';
}

function isLocalResearchFocus(focusMode: string | undefined): boolean {
  return focusMode === undefined || focusMode === 'localResearch';
}

function resolveOne(
  requestedCapability: string,
  facts: CapabilityRuntimeFacts,
): CapabilityAvailability {
  const capability = safeCapabilityLabel(requestedCapability);
  const key = capabilityKey(capability);
  const search = facts.searchCapabilities;
  let status: CapabilityAvailabilityStatus;

  switch (key) {
    case 'web':
    case 'web search':
    case 'internet search':
      status = !isWebFocus(facts.focusMode)
        ? 'disabled'
        : tristate(search?.web, 'not configured');
      break;
    case 'image search':
    case 'images':
      status = !isWebFocus(facts.focusMode)
        ? 'disabled'
        : tristate(search?.images, 'not configured');
      break;
    case 'video search':
    case 'videos':
      status = !isWebFocus(facts.focusMode)
        ? 'disabled'
        : tristate(search?.videos, 'not configured');
      break;
    case 'autocomplete':
      status = tristate(search?.autocomplete, 'not configured');
      break;
    case 'local research':
    case 'file search':
    case 'uploaded files':
    case 'attachments':
      status =
        !isLocalResearchFocus(facts.focusMode) &&
        facts.focusMode !== 'webSearch'
          ? 'disabled'
          : tristate(facts.hasFiles, 'not configured');
      break;
    case 'workspace':
    case 'workspace files':
      status = tristate(facts.hasWorkspace, 'not configured');
      break;
    case 'memory':
    case 'saved memory':
      status =
        facts.isPrivate === true
          ? 'disabled'
          : tristate(facts.memoryEnabled, 'disabled');
      break;
    case 'personalization':
      status =
        facts.isPrivate === true
          ? 'disabled'
          : tristate(facts.hasPersonalization, 'disabled');
      break;
    case 'code execution':
    case 'code':
      if (facts.interactiveSession === false) status = 'disabled';
      else if (facts.codeExecutionConfigured === false)
        status = 'not configured';
      else status = tristate(facts.codeExecutionEnabled, 'disabled');
      break;
    case 'image generation':
    case 'generated images':
      if (facts.imageGenerationConfigured === false) status = 'not configured';
      else if (facts.hasDurableChat === false) status = 'disabled';
      else status = tristate(facts.imageGenerationEnabled, 'disabled');
      break;
    case 'artifacts':
    case 'artifact':
      if (
        (facts.focusMode !== undefined &&
          facts.focusMode !== 'webSearch' &&
          facts.focusMode !== 'localResearch') ||
        facts.isPrivate === true
      ) {
        status = 'disabled';
      } else {
        status = tristate(facts.hasDurableChat, 'not configured');
      }
      break;
    case 'deep research':
      status =
        facts.focusMode === undefined || facts.focusMode === 'webSearch'
          ? 'available'
          : 'disabled';
      break;
    case 'private sessions':
    case 'private session':
      status = 'available';
      break;
    default:
      status = 'unknown on this device';
      break;
  }

  return { capability, status };
}

/** Resolve one or more status requests using only the supplied local facts. */
export function getCapabilityAvailability(
  capability: string | readonly string[],
  facts: CapabilityRuntimeFacts = {},
): CapabilityAvailability | CapabilityAvailability[] {
  if (Array.isArray(capability)) {
    return capability.map((item) => resolveOne(String(item), facts));
  }
  return resolveOne(String(capability), facts);
}
