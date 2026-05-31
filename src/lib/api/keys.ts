import type { ChatsFilter } from '@/lib/hooks/api/useChats';

type ChatsSearchFilter = Omit<ChatsFilter, 'pinned' | 'scheduled'>;

// Namespace roots — scoped key factories build on these so reads and
// invalidations share a single source of truth.
const SKILLS_NS = ['skills'] as const;
const MEMORIES_NS = ['memories'] as const;

export const qk = {
  config: ['config'] as const,
  models: ['models'] as const,
  tools: ['tools'] as const,
  workspaces: (archived?: boolean) => ['workspaces', { archived }] as const,
  workspace: (id: string) => ['workspaces', id] as const,
  workspaceFiles: (id: string) => ['workspaces', id, 'files'] as const,
  workspaceUrls: (id: string) => ['workspaces', id, 'urls'] as const,
  workspaceMemory: (id: string) => ['workspaces', id, 'memory'] as const,
  workspaceSysPrompts: (id: string) =>
    ['workspaces', id, 'system-prompts'] as const,
  systemPrompts: ['system-prompts'] as const,
  skillsRoot: SKILLS_NS,
  skills: (workspaceId?: string | null) =>
    [...SKILLS_NS, { workspaceId }] as const,
  memoriesRoot: MEMORIES_NS,
  memories: (workspaceId?: string | null) =>
    [...MEMORIES_NS, { workspaceId }] as const,
  scheduledTasks: ['scheduled-tasks'] as const,
  scheduledRuns: ['scheduled-task-runs'] as const,
  scheduledRunsUnread: ['scheduled-task-runs', 'unread'] as const,
  chatsRoot: ['chats'] as const,
  chatsInfiniteRoot: ['chats', 'infinite'] as const,
  chatsInfinite: (filter: ChatsFilter) =>
    ['chats', 'infinite', filter] as const,
  chatSearchRoot: ['chats', 'search'] as const,
  chatSearch: (q: string, filter: ChatsSearchFilter) =>
    ['chats', 'search', q, filter] as const,
  chatLlmSearch: (query: string, filter: ChatsSearchFilter) =>
    ['chats', 'search', 'llm', query, filter] as const,
  message: (id: string) => ['messages', id] as const,
  activeRuns: ['active-runs'] as const,
};
