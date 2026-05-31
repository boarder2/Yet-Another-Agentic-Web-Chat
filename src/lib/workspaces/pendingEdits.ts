import { createEditApprovalStore } from '@/lib/approvals/editApproval';

export type { EditDecision } from '@/lib/approvals/editApproval';

const store = createEditApprovalStore('__workspaceEditApprovalPending', 'Edit');

export const waitForApprovalResponse = store.waitForApprovalResponse;
export const resolveEditApproval = store.resolveEditApproval;
export const cancelEditsForMessage = store.cancelEditsForMessage;
export const cleanupAllApprovals = store.cleanupAllApprovals;
