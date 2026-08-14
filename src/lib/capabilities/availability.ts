export const CAPABILITY_AVAILABILITY_STATUSES = [
  'available',
  'disabled',
  'not configured',
  'unknown on this device',
] as const;

export type CapabilityAvailabilityStatus =
  (typeof CAPABILITY_AVAILABILITY_STATUSES)[number];

export interface CapabilitySearchFacts {
  web?: boolean;
  images?: boolean;
  videos?: boolean;
  autocomplete?: boolean;
}

/** Only non-sensitive, already-known facts may cross the tool boundary. */
export interface CapabilityRuntimeFacts {
  focusMode?: string;
  isPrivate?: boolean;
  hasFiles?: boolean;
  hasWorkspace?: boolean;
  memoryEnabled?: boolean;
  interactiveSession?: boolean;
  hasDurableChat?: boolean;
  hasPersonalization?: boolean;
  codeExecutionConfigured?: boolean;
  codeExecutionEnabled?: boolean;
  imageGenerationConfigured?: boolean;
  imageGenerationEnabled?: boolean;
  searchCapabilities?: CapabilitySearchFacts;
}

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

function statusForSearchCapability(
  value: boolean | undefined,
): CapabilityAvailabilityStatus {
  if (value === true) return 'available';
  if (value === false) return 'not configured';
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
        : statusForSearchCapability(search?.web);
      break;
    case 'image search':
    case 'images':
      status = !isWebFocus(facts.focusMode)
        ? 'disabled'
        : statusForSearchCapability(search?.images);
      break;
    case 'video search':
    case 'videos':
      status = !isWebFocus(facts.focusMode)
        ? 'disabled'
        : statusForSearchCapability(search?.videos);
      break;
    case 'autocomplete':
      status = statusForSearchCapability(search?.autocomplete);
      break;
    case 'local research':
    case 'file search':
    case 'uploaded files':
    case 'attachments':
      if (
        !isLocalResearchFocus(facts.focusMode) &&
        facts.focusMode !== 'webSearch'
      ) {
        status = 'disabled';
      } else if (facts.hasFiles === true) {
        status = 'available';
      } else if (facts.hasFiles === false) {
        status = 'not configured';
      } else {
        status = 'unknown on this device';
      }
      break;
    case 'workspace':
    case 'workspace files':
      status =
        facts.hasWorkspace === true
          ? 'available'
          : facts.hasWorkspace === false
            ? 'not configured'
            : 'unknown on this device';
      break;
    case 'memory':
    case 'saved memory':
      if (facts.isPrivate === true) status = 'disabled';
      else if (facts.memoryEnabled === true) status = 'available';
      else if (facts.memoryEnabled === false) status = 'disabled';
      else status = 'unknown on this device';
      break;
    case 'personalization':
      if (facts.isPrivate === true) status = 'disabled';
      else if (facts.hasPersonalization === true) status = 'available';
      else if (facts.hasPersonalization === false) status = 'disabled';
      else status = 'unknown on this device';
      break;
    case 'code execution':
    case 'code':
      if (facts.interactiveSession === false) status = 'disabled';
      else if (facts.codeExecutionConfigured === false)
        status = 'not configured';
      else if (facts.codeExecutionEnabled === true) status = 'available';
      else if (facts.codeExecutionEnabled === false) status = 'disabled';
      else status = 'unknown on this device';
      break;
    case 'image generation':
    case 'generated images':
      if (facts.imageGenerationConfigured === false) {
        status = 'not configured';
      } else if (facts.imageGenerationEnabled === false) {
        status = 'disabled';
      } else if (facts.hasDurableChat === false) {
        status = 'disabled';
      } else if (facts.imageGenerationEnabled === true) {
        status = 'available';
      } else {
        status = 'unknown on this device';
      }
      break;
    case 'artifacts':
    case 'artifact':
      if (
        facts.focusMode !== undefined &&
        facts.focusMode !== 'webSearch' &&
        facts.focusMode !== 'localResearch'
      ) {
        status = 'disabled';
      } else if (facts.isPrivate === true) status = 'disabled';
      else if (facts.hasDurableChat === true) status = 'available';
      else if (facts.hasDurableChat === false) status = 'not configured';
      else status = 'unknown on this device';
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

export const resolveCapabilityAvailability = getCapabilityAvailability;
export const resolveCapabilityStatus = getCapabilityAvailability;

export function getCapabilityAvailabilityMap(
  capabilities: readonly string[],
  facts: CapabilityRuntimeFacts = {},
): CapabilityAvailability[] {
  return capabilities.map((capability) => resolveOne(capability, facts));
}
