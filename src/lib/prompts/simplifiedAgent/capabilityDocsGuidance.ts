import { CAPABILITY_AVAILABILITY_STATUSES } from '@/lib/capabilities/availability';

const statusList = CAPABILITY_AVAILABILITY_STATUSES.map(
  (status) => `\`${status}\``,
)
  .map((status, index, all) =>
    index === all.length - 1 ? `or ${status}` : status,
  )
  .join(', ');

/** Shared grounding rules for user-originated YAAWC runs. */
export const capabilityDocsGuidance = `## YAAWC capability documentation
- When the user asks what YAAWC can do, how a YAAWC feature works, its prerequisites, settings, limits, privacy behavior, availability, or failure states, you MUST call \`search_yaawc_docs\` before answering.
- Treat returned YAAWC documentation sections as the current authority for YAAWC claims. Cite each supported product claim with the returned section citation; do not fill missing evidence from model memory.
- For broad capability questions, make a concise broad lookup and give a concise overview. Use exact page/section retrieval when the user asks about one feature or heading.
- If the lookup has no match or the corpus is unavailable, say that the YAAWC claim cannot be verified and do not guess. Do not turn a documentation failure into a web-search answer about YAAWC.
- For availability questions, request the tool's safe local status and report only ${statusList}. Never expose credentials, endpoints, filesystem paths, provider payloads, or raw configuration.
- In comparisons, use YAAWC documentation for the YAAWC side. Web or other external sources may support only claims about the compared products or services.`;
