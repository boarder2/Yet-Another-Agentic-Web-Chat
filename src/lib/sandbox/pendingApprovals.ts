type PendingApproval = {
  resolve: (result: { approved: boolean }) => void;
  timeout: NodeJS.Timeout;
  messageId?: string;
  createdAt: number;
};

const globalSandbox = globalThis as typeof globalThis & {
  __codeExecutionPendingApprovals?: Map<string, PendingApproval>;
};

const pending =
  globalSandbox.__codeExecutionPendingApprovals ??
  (globalSandbox.__codeExecutionPendingApprovals = new Map<
    string,
    PendingApproval
  >());

export function waitForApproval(
  executionId: string,
  timeoutMs: number = 300_000,
  messageId?: string,
): Promise<{ approved: boolean }> {
  return new Promise((resolve) => {
    if (pending.size > 100) {
      console.warn(
        `Code execution approval map has ${pending.size} live entries; check for orphaned approvals.`,
      );
    }

    const timeout = setTimeout(() => {
      pending.delete(executionId);
      resolve({ approved: false });
    }, timeoutMs);

    pending.set(executionId, {
      resolve,
      timeout,
      messageId,
      createdAt: Date.now(),
    });
  });
}

export function resolveApproval(
  executionId: string,
  approved: boolean,
): boolean {
  const entry = pending.get(executionId);
  if (!entry) return false;

  clearTimeout(entry.timeout);
  pending.delete(executionId);
  entry.resolve({ approved });
  return true;
}

/**
 * Auto-deny all pending approvals for a given messageId.
 * Called when the SSE stream disconnects (page refresh, tab close, etc.)
 * to prevent orphaned 5-minute waits.
 */
export function denyApprovalsForMessage(messageId: string): void {
  for (const [id, entry] of pending) {
    if (entry.messageId === messageId) {
      clearTimeout(entry.timeout);
      pending.delete(id);
      entry.resolve({ approved: false });
    }
  }
}

export function cleanupAllApprovals(): void {
  for (const [id, entry] of pending) {
    clearTimeout(entry.timeout);
    entry.resolve({ approved: false });
    pending.delete(id);
  }
}
