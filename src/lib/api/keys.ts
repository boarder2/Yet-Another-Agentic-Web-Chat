export interface ChatFilters {
  workspaceId?: string | null;
  page?: number;
}

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
  skills: (workspaceId?: string | null) => ['skills', { workspaceId }] as const,
  memories: (workspaceId?: string | null) =>
    ['memories', { workspaceId }] as const,
  scheduledTasks: ['scheduled-tasks'] as const,
  scheduledRuns: ['scheduled-task-runs'] as const,
  chats: (filters: ChatFilters) => ['chats', filters] as const,
  chatSearch: (q: string, ws?: string) => ['chats', 'search', q, ws] as const,
  message: (id: string) => ['messages', id] as const,
};
