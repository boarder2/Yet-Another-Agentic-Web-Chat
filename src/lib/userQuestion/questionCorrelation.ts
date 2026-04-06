/**
 * Correlates callback runIds from handleToolStart with user_question_pending events.
 *
 * When parallel ask_user tools run, handleToolStart fires in order but
 * the user_question_pending events may arrive in a different order.
 * This module provides a direct correlation using the question text as the key,
 * with per-key FIFO queues for identical questions.
 */
const questionRunIdQueues = new Map<string, string[]>();

/**
 * Called from handleToolStart when an ask_user tool starts.
 * Stores the callback runId keyed by the question text.
 */
export function pushCallbackRunId(question: string, runId: string) {
  const queue = questionRunIdQueues.get(question) || [];
  queue.push(runId);
  questionRunIdQueues.set(question, queue);
}

/**
 * Called from askUserTool when emitting user_question_pending.
 * Returns the callback runId (used as toolCallId in ToolCall markup) for correlation.
 */
export function popCallbackRunId(question: string): string | undefined {
  const queue = questionRunIdQueues.get(question);
  if (!queue || queue.length === 0) return undefined;
  const runId = queue.shift()!;
  if (queue.length === 0) questionRunIdQueues.delete(question);
  return runId;
}
