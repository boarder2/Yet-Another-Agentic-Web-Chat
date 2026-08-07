import type { ChatsFilter } from '@/lib/hooks/api/useChats';

type ChatsSearchFilter = Omit<ChatsFilter, 'pinned' | 'scheduled'>;

// Namespace roots — scoped key factories build on these so reads and
// invalidations share a single source of truth.
const SKILLS_NS = ['skills'] as const;
const MEMORIES_NS = ['memories'] as const;
const ARTIFACTS_NS = ['artifacts'] as const;

export const qk = {
  config: ['config'] as const,
  settings: ['settings'] as const,
  models: ['models'] as const,
  tools: ['tools'] as const,
  voices: ['tts', 'voices'] as const,
  workspaces: (archived?: boolean) => ['workspaces', { archived }] as const,
  workspace: (id: string) => ['workspaces', id] as const,
  workspaceFiles: (id: string) => ['workspaces', id, 'files'] as const,
  workspaceMemory: (id: string) => ['workspaces', id, 'memory'] as const,
  workspaceSysPrompts: (id: string) =>
    ['workspaces', id, 'system-prompts'] as const,
  systemPrompts: ['system-prompts'] as const,
  skillsRoot: SKILLS_NS,
  skills: (workspaceId?: string | null, enabledOnly?: boolean) =>
    [...SKILLS_NS, { workspaceId, enabledOnly }] as const,
  memoriesRoot: MEMORIES_NS,
  memories: (workspaceId?: string | null) =>
    [...MEMORIES_NS, { workspaceId }] as const,
  mcpServers: ['mcp-servers'] as const,
  mcpServer: (id: string) => ['mcp-servers', id] as const,
  mcpServerTools: (id: string) => ['mcp-servers', id, 'tools'] as const,
  mcpServerWorkspaces: (id: string) =>
    ['mcp-servers', id, 'workspaces'] as const,
  workflows: ['workflows'] as const,
  workflow: (id: string) => ['workflows', id] as const,
  workflowSchedules: (id: string) => ['workflows', id, 'schedules'] as const,
  schedules: ['schedules'] as const,
  schedule: (id: string) => ['schedules', id] as const,
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
  artifactsRoot: ARTIFACTS_NS,
  artifacts: (chatId: string) => [...ARTIFACTS_NS, { chatId }] as const,
  workspaceArtifacts: (workspaceId: string) =>
    [...ARTIFACTS_NS, { workspaceId }] as const,
  allArtifacts: (filter: { workspaceIds?: string[] }) =>
    [...ARTIFACTS_NS, { all: true, filter }] as const,
  artifact: (id: string) => [...ARTIFACTS_NS, id] as const,
  artifactSource: (id: string, version?: number) =>
    [...ARTIFACTS_NS, id, 'source', version] as const,
};
