import { createApprovalStore } from '@/lib/approvals/createApprovalStore';

type SandboxApprovalResponse = { approved: boolean; reason?: string };

const store = createApprovalStore<SandboxApprovalResponse>({
  globalKey: '__codeExecutionPendingApprovals',
  defaultTimeoutMs: 300_000,
  timedOutValue: { approved: false },
  label: 'Code execution',
});

export function waitForApproval(
  executionId: string,
  timeoutMs?: number,
  messageId?: string,
): Promise<SandboxApprovalResponse> {
  return store.waitFor(executionId, timeoutMs, messageId);
}

export function resolveApproval(
  executionId: string,
  approved: boolean,
  reason?: string,
): boolean {
  return store.resolve(executionId, { approved, reason });
}

/**
 * Auto-deny all pending approvals for a given messageId.
 * Called when the SSE stream disconnects (page refresh, tab close, etc.)
 * to prevent orphaned 5-minute waits.
 */
export function denyApprovalsForMessage(messageId: string): void {
  store.cancelForMessage(messageId);
}

export function cleanupAllApprovals(): void {
  store.cleanupAll();
}
