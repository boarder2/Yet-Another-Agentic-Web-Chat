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
  type: text('type', { enum: ['system', 'persona'] })
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
  createdAt: text('createdAt').notNull(),
  focusMode: text('focusMode').notNull(),
  files: text('files', { mode: 'json' })
    .$type<File[]>()
    .default(sql`'[]'`),
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
