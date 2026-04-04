/**
 * Correlates callback runIds from handleToolStart with code_execution_pending events.
 *
 * When parallel code_execution tools run, handleToolStart fires in order but
 * the code_execution_pending events may arrive in a different order due to async
 * initialization (Docker checks). This module provides a direct correlation
 * using the code content as the key, with per-key FIFO queues for identical code.
 */
const codeRunIdQueues = new Map<string, string[]>();

/**
 * Called from handleToolStart when a code_execution tool starts.
 * Stores the callback runId keyed by the code content.
 */
export function pushCallbackRunId(code: string, runId: string) {
  const queue = codeRunIdQueues.get(code) || [];
  queue.push(runId);
  codeRunIdQueues.set(code, queue);
}

/**
 * Called from codeExecutionTool when emitting code_execution_pending.
 * Returns the callback runId (used as toolCallId in ToolCall markup) for correlation.
 */
export function popCallbackRunId(code: string): string | undefined {
  const queue = codeRunIdQueues.get(code);
  if (!queue || queue.length === 0) return undefined;
  const runId = queue.shift()!;
  if (queue.length === 0) codeRunIdQueues.delete(code);
  return runId;
}
