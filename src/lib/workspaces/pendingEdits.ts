export type EditDecision =
  | 'accept'
  | 'accept_always'
  | 'reject'
  | 'always_prompt';

type ApprovalResponse = {
  decision: EditDecision;
  freeformText?: string;
  timedOut?: boolean;
};

type PendingApproval = {
  resolve: (result: ApprovalResponse) => void;
  timeout: NodeJS.Timeout;
  messageId?: string;
  createdAt: number;
};

const globalStore = globalThis as typeof globalThis & {
  __workspaceEditApprovalPending?: Map<string, PendingApproval>;
};

const pending =
  globalStore.__workspaceEditApprovalPending ??
  (globalStore.__workspaceEditApprovalPending = new Map<
    string,
    PendingApproval
  >());

export function waitForApprovalResponse(
  approvalId: string,
  timeoutMs: number = 900_000,
  messageId?: string,
): Promise<ApprovalResponse> {
  return new Promise((resolve) => {
    if (pending.size > 100) {
      console.warn(
        `Edit approval map has ${pending.size} live entries; check for orphaned approvals.`,
      );
    }

    const timeout = setTimeout(() => {
      pending.delete(approvalId);
      resolve({ timedOut: true, decision: 'reject' });
    }, timeoutMs);

    pending.set(approvalId, {
      resolve,
      timeout,
      messageId,
      createdAt: Date.now(),
    });
  });
}

export function resolveEditApproval(
  approvalId: string,
  decision: EditDecision,
  freeformText?: string,
): boolean {
  const entry = pending.get(approvalId);
  if (!entry) return false;

  clearTimeout(entry.timeout);
  pending.delete(approvalId);
  entry.resolve({ decision, freeformText });
  return true;
}

export function cancelEditsForMessage(messageId: string): void {
  for (const [id, entry] of pending) {
    if (entry.messageId === messageId) {
      clearTimeout(entry.timeout);
      pending.delete(id);
      entry.resolve({ timedOut: true, decision: 'reject' });
    }
  }
}

export function cleanupAllApprovals(): void {
  for (const [id, entry] of pending) {
    clearTimeout(entry.timeout);
    entry.resolve({ timedOut: true, decision: 'reject' });
    pending.delete(id);
  }
}
