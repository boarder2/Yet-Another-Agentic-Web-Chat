import { sql } from 'drizzle-orm';
import { text, integer, sqliteTable } from 'drizzle-orm/sqlite-core';

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
