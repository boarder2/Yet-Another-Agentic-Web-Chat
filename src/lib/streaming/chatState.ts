/**
 * The data shapes that make up the consolidated chat stream state. Defined in
 * the streaming module (not a component) so the pure reducer and the UI both
 * depend on the same source of truth — the reducer never imports from
 * `@/components`. `ModelStats`/`TokenUsage` live in {@link ./events} (the wire
 * vocabulary's single source of truth) and are re-exported here for convenience.
 */
import type { Document } from '@langchain/core/documents';
import type { ModelStats } from './events';

export type { ModelStats, TokenUsage } from './events';

export interface File {
  fileName: string;
  fileExtension: string;
  fileId: string;
}

export interface ImageAttachment {
  imageId: string;
  fileName: string;
  mimeType: string;
}

export type CompactionData = {
  summary: string;
  compactedMessageCount: number;
  tokensBefore: number;
  tokensAfter: number;
  compactedAt: string;
};

export type Message = {
  messageId: string;
  chatId: string;
  createdAt: Date;
  content: string;
  role: 'user' | 'assistant' | 'compaction';
  suggestions?: string[];
  sources?: Document[];
  modelStats?: ModelStats;
  searchQuery?: string;
  searchUrl?: string;
  expandedThinkBoxes?: Set<string>;
  usedLocation?: boolean;
  usedPersonalization?: boolean;
  images?: ImageAttachment[];
  compaction?: CompactionData;
  invokedSkills?: string[];
  /** Set when this row was written by an in-flight run. 'interrupted' means the
   *  server was restarted before the run completed. */
  runStatus?: 'running' | 'interrupted' | 'cancelled' | 'errored';
};

export type PendingExecution = {
  executionId: string;
  code: string;
  description?: string;
  toolCallId?: string;
  status: 'pending' | 'approved' | 'denied' | 'completed' | 'cancelled';
  result?: {
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    timedOut?: boolean;
    oomKilled?: boolean;
    denied?: boolean;
  };
};

export type PendingQuestion = {
  questionId: string;
  question: string;
  options?: { label: string; description?: string }[];
  multiSelect?: boolean;
  allowFreeformInput?: boolean;
  context?: string;
  toolCallId?: string;
  createdAt?: number;
  status: 'pending' | 'answered' | 'skipped' | 'timed_out' | 'cancelled';
  response?: {
    selectedOptions?: string[];
    freeformText?: string;
  };
};

export type PendingEditApproval = {
  approvalId: string;
  toolCallId?: string;
  action: 'edit' | 'create';
  workspaceId: string;
  fileId?: string;
  file: string;
  oldString?: string;
  newString?: string;
  content?: string;
  replaceAll?: boolean;
  occurrences?: number;
  workspaceAutoAccept: boolean;
  fileAutoAccept: number | null;
  createdAt?: number;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
};

export type PendingSkillEditApproval = {
  approvalId: string;
  toolCallId?: string;
  action: 'create' | 'update' | 'delete';
  name: string;
  oldDescription: string;
  newDescription: string;
  oldContent: string;
  newContent: string;
  scope: 'global' | 'workspace';
  workspaceId?: string | null;
  skillId?: string;
  createdAt?: number;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
};

export type PendingMcpApproval = {
  approvalId: string;
  toolCallId?: string;
  serverId?: string;
  serverName: string;
  toolName: string;
  namespacedName: string;
  description: string;
  arguments: Record<string, unknown>;
  createdAt?: number;
  status: 'pending' | 'approved' | 'denied' | 'cancelled';
};
