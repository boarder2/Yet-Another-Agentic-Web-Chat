import { sql } from 'drizzle-orm';
import {
  text,
  integer,
  sqliteTable,
  primaryKey,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const messages = sqliteTable('messages', {
  id: integer('id').primaryKey(),
  content: text('content').notNull(),
  chatId: text('chatId').notNull(),
  messageId: text('messageId').notNull(),
  role: text('type', { enum: ['assistant', 'user'] }),
  metadata: text('metadata', {
    mode: 'json',
  }),
});

interface File {
  name: string;
  fileId: string;
}

export const systemPrompts = sqliteTable('system_prompts', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  content: text('content').notNull(),
  type: text('type', { enum: ['system', 'persona', 'methodology'] })
    .notNull()
    .default('system'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const chats = sqliteTable('chats', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  createdAt: integer('createdAt').notNull(),
  focusMode: text('focusMode').notNull(),
  files: text('files', { mode: 'json' })
    .$type<File[]>()
    .default(sql`'[]'`),
  isPrivate: integer('is_private')
    .notNull()
    .default(sql`0`),
  scheduledTaskId: text('scheduled_task_id'),
  scheduledRunViewed: integer('scheduled_run_viewed'),
  pinned: integer('pinned')
    .notNull()
    .default(sql`0`),
  workspaceId: text('workspace_id'),
});

export const memories = sqliteTable('memories', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().default('default'),
  content: text('content').notNull(),
  embedding: text('embedding'),
  embeddingModel: text('embedding_model'),
  category: text('category', {
    enum: ['Preference', 'Profile', 'Professional', 'Project', 'Instruction'],
  }),
  sourceType: text('source_type', { enum: ['manual', 'automatic'] }),
  sourceChatId: text('source_chat_id'),
  accessCount: integer('access_count').notNull().default(0),
  lastAccessedAt: integer('last_accessed_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  workspaceId: text('workspace_id'),
});

export const scheduledTasks = sqliteTable('scheduled_tasks', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  prompt: text('prompt').notNull(),
  focusMode: text('focus_mode').notNull(),
  sourceUrls: text('source_urls', { mode: 'json' })
    .$type<string[]>()
    .default(sql`'[]'`),
  chatModel: text('chat_model', { mode: 'json' })
    .$type<{ provider: string; name: string; ollamaContextWindow?: number }>()
    .notNull(),
  systemModel: text('system_model', { mode: 'json' }).$type<{
    provider: string;
    name: string;
    ollamaContextWindow?: number;
  } | null>(),
  embeddingModel: text('embedding_model', { mode: 'json' })
    .$type<{ provider: string; name: string }>()
    .notNull(),
  selectedSystemPromptIds: text('selected_system_prompt_ids', { mode: 'json' })
    .$type<string[]>()
    .default(sql`'[]'`),
  selectedMethodologyId: text('selected_methodology_id'),
  cronExpression: text('cron_expression').notNull(),
  timezone: text('timezone'),
  enabled: integer('enabled')
    .notNull()
    .default(sql`1`),
  lastRunAt: integer('last_run_at', { mode: 'timestamp' }),
  lastRunStatus: text('last_run_status', {
    enum: ['success', 'error'],
  }),
  lastRunError: text('last_run_error'),
  lastRunChatId: text('last_run_chat_id'),
  retentionMode: text('retention_mode', {
    enum: ['days', 'count', 'disabled'],
  }),
  retentionValue: integer('retention_value'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const workspaces = sqliteTable('workspaces', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  description: text('description'),
  color: text('color'),
  icon: text('icon'),
  instructions: text('instructions'),
  sourceUrls: text('source_urls', { mode: 'json' })
    .$type<string[]>()
    .default(sql`'[]'`),
  autoMemoryEnabled: integer('auto_memory_enabled'),
  autoAcceptFileEdits: integer('auto_accept_file_edits').notNull().default(0),
  archivedAt: integer('archived_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const workspaceSystemPrompts = sqliteTable(
  'workspace_system_prompts',
  {
    workspaceId: text('workspace_id').notNull(),
    systemPromptId: text('system_prompt_id').notNull(),
    order: integer('order').notNull().default(0),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.workspaceId, t.systemPromptId] }),
  }),
);

export const workspaceFiles = sqliteTable(
  'workspace_files',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    workspaceId: text('workspace_id').notNull(),
    name: text('name').notNull(),
    mime: text('mime'),
    size: integer('size').notNull(),
    sha256: text('sha256').notNull(),
    autoAcceptEdits: integer('auto_accept_edits'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    uniqWorkspaceName: uniqueIndex('uniq_workspace_file_name').on(
      t.workspaceId,
      t.name,
    ),
  }),
);
