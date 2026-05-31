import { createApprovalStore } from './createApprovalStore';

export type EditDecision =
  | 'accept'
  | 'accept_always'
  | 'reject'
  | 'always_prompt';

export type EditApprovalResponse = {
  decision: EditDecision;
  freeformText?: string;
  timedOut?: boolean;
};

/**
 * Builds the standard edit-approval API (skill edits, workspace file edits)
 * on top of {@link createApprovalStore}. Both flows share an identical
 * lifecycle and payload shape; only the global key and warning label differ.
 */
export function createEditApprovalStore(globalKey: string, label: string) {
  const store = createApprovalStore<EditApprovalResponse>({
    globalKey,
    defaultTimeoutMs: 900_000,
    timedOutValue: { timedOut: true, decision: 'reject' },
    label,
  });

  return {
    waitForApprovalResponse(
      approvalId: string,
      timeoutMs?: number,
      messageId?: string,
    ): Promise<EditApprovalResponse> {
      return store.waitFor(approvalId, timeoutMs, messageId);
    },
    resolveEditApproval(
      approvalId: string,
      decision: EditDecision,
      freeformText?: string,
    ): boolean {
      return store.resolve(approvalId, { decision, freeformText });
    },
    cancelEditsForMessage(messageId: string): void {
      store.cancelForMessage(messageId);
    },
    cleanupAllApprovals(): void {
      store.cleanupAll();
    },
  };
}
