import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export const WORKFLOW_TOOL_NAMES = [
  'workflow_triage',
  'workflow_end_grilling',
  'workflow_write_plan',
  'workflow_run_chunk',
  'workflow_close',
] as const;

const workflowTools = new Set<string>(WORKFLOW_TOOL_NAMES);

/** Keep workflow tools out of ordinary sessions without disturbing other tools. */
export function setWorkflowToolsActive(
  pi: Pick<ExtensionAPI, 'getActiveTools' | 'setActiveTools'>,
  active: boolean,
): void {
  const current = pi.getActiveTools();
  const next = active
    ? [...new Set([...current, ...WORKFLOW_TOOL_NAMES])]
    : current.filter((name) => !workflowTools.has(name));

  if (
    next.length !== current.length ||
    next.some((name, index) => name !== current[index])
  ) {
    pi.setActiveTools(next);
  }
}
