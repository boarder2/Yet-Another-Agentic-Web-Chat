/**
 * Panel executor tool restrictions.
 *
 * Panel executors are full agentic SimplifiedAgents, but — unlike the
 * orchestrator — they must never prompt the user or perform approval-gated /
 * mutating actions, and they must not recurse into another panel/deep_research
 * fan-out. They keep read-only research + read-only workspace tools.
 *
 * This mirrors how `SubagentExecutor` constrains tools, but uses an exclusion
 * list (remove the prompting/mutating set) rather than a whitelist, so executors
 * inherit the full focus-mode toolset minus the excluded tools.
 */

// Tools removed for panel executors: prompting/approval-gated, mutating, or
// recursive. Read-only workspace tools (ls/grep/read) intentionally stay — they
// never interrupt. Names match the tool `name` fields in src/lib/tools/.
export const PANEL_EXECUTOR_EXCLUDED_TOOLS: string[] = [
  'code_execution',
  'workspace_edit',
  'workspace_create_file',
  'ask_user',
  'edit_skill',
  'deep_research',
];

const EXCLUDED = new Set(PANEL_EXECUTOR_EXCLUDED_TOOLS);

/**
 * Remove the prompting/approval/recursive tools from a focus-mode toolset for
 * use by a panel executor. Generic over the tool element type so it works for
 * both the base tool arrays and the interactive-augmented arrays.
 */
export function filterExecutorTools<T extends { name: string }>(
  focusModeTools: T[],
): T[] {
  return focusModeTools.filter((t) => !EXCLUDED.has(t.name));
}
