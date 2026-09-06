import { sql } from 'drizzle-orm';
import {
  text,
  integer,
  sqliteTable,
  primaryKey,
  uniqueIndex,
  index,
} from 'drizzle-orm/sqlite-core';
import type { WorkspaceModelOverride } from '@/lib/workspaces/types';
import type { ModelRef } from '@/lib/providers/resolveModels';

export const messages = sqliteTable(
  'messages',
  {
    id: integer('id').primaryKey(),
    content: text('content').notNull(),
    // Derived from `content` by removeToolCallMarkup (see src/lib/db/sanitizedContent.ts):
    // execution UI markup (widget envelopes, legacy tool tags) stripped, ordinary
    // prose kept. Null means a pre-migration row not yet backfilled. The sole
    // message-text source for history search; never returned by chat/History APIs.
    sanitizedContent: text('sanitized_content'),
    chatId: text('chatId').notNull(),
    messageId: text('messageId').notNull(),
    role: text('type', {
      enum: ['assistant', 'user', 'compaction', 'system'],
    }),
    metadata: text('metadata', {
      mode: 'json',
    }),
  },
  (t) => ({
    // Rows carry the full message text, so an unindexed lookup scans every
    // byte of chat history. `(chatId, role)` also serves chatId-only reads.
    byChat: index('messages_chat_idx').on(t.chatId, t.role),
    byMessage: index('messages_message_idx').on(t.messageId),
  }),
);

interface File {
  name: string;
  fileId: string;
}

// Cached Mode-2 (LLM) narration for a message's read-aloud. Narration is
// voice/speed-independent text, so one row per message. `contentHash` folds in
// the message content *and* the narration model identity, so editing the message
// or switching the narration model invalidates and regenerates. Kept in its own
// table (not a messages column) so this potentially-large text never loads on the
// hot chat-fetch path — only the TTS route reads it.
export const ttsNarrations = sqliteTable('tts_narrations', {
  messageId: text('message_id').primaryKey(),
  contentHash: text('content_hash').notNull(),
  narration: text('narration').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Instance-wide app settings, stored as a flat key→string map. Mirrors the
// browser localStorage key space exactly (values are the same serialized
// strings the client cache holds) so the DB is the durable, cross-device source
// of truth while localStorage acts as a synchronous local cache. Only the keys
// in MIGRATED_SETTING_KEYS (src/lib/settings/keys.ts) ever land here —
// device-local UI prefs (theme, chat width) stay in localStorage only, and
// secrets (provider/search API keys, MCP auth) live encrypted in `credentials`
// (src/lib/credentials.ts), never here — this table is returned verbatim to
// the client by GET /api/settings.
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

// Encrypted credential storage (AES-256-GCM, src/lib/encryption.ts), keyed by
// logical name (see CREDENTIAL_KEYS in src/lib/credentials.ts). Deliberately
// its own table, not `app_settings` — that table is shipped verbatim to every
// client by GET /api/settings, so ciphertext must never land there.
export const credentials = sqliteTable('credentials', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

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
  // Set when the title is a deliberate manual rename, so auto-title
  // regeneration on first-turn completion never clobbers it.
  titleLocked: integer('title_locked')
    .notNull()
    .default(sql`0`),
  createdAt: integer('createdAt').notNull(),
  focusMode: text('focusMode').notNull(),
  files: text('files', { mode: 'json' })
    .$type<File[]>()
    .default(sql`'[]'`),
  isPrivate: integer('is_private')
    .notNull()
    .default(sql`0`),
  // Provenance for runs seeded from a workflow. `scheduleId` is set on headless
  // scheduled runs (run-history FK); `workflowId` is stamped on manual seeded
  // chats. Both null out on delete so chats survive (Decision 19).
  scheduleId: text('schedule_id'),
  workflowId: text('workflow_id'),
  // Legacy: pre-workflows scheduled-run provenance. Retained only so the boot
  // migration (migrateScheduledTasks) can remap it into `scheduleId`; no live
  // code reads it. Not dropped because that would be a destructive schema diff.
  scheduledTaskId: text('scheduled_task_id'),
  pinned: integer('pinned')
    .notNull()
    .default(sql`0`),
  workspaceId: text('workspace_id'),
  activeRunMessageId: text('active_run_message_id'),
  activeRunStartedAt: integer('active_run_started_at'),
  activeRunStatus: text('active_run_status', {
    enum: ['running', 'awaiting_user'],
  }),
  activeRunThreadId: text('active_run_thread_id'),
  activeRunConfigSnapshot: text('active_run_config_snapshot', { mode: 'json' }),
  lastRunStatus: text('last_run_status', {
    enum: ['completed', 'errored', 'cancelled', 'interrupted', 'awaiting_user'],
  }),
  lastRunViewed: integer('last_run_viewed'),
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

// Legacy pre-workflows table. Superseded by `workflows` + `schedules`; retained
// (not dropped) only so the boot migration `migrateScheduledTasks` can copy its
// rows into the new pair. No live code reads it — dropping it would be a
// destructive schema diff, so it stays defined but empty after migration.
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
  chatModel: text('chat_model', { mode: 'json' }).$type<ModelRef>().notNull(),
  systemModel: text('system_model', { mode: 'json' }).$type<ModelRef | null>(),
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

// A reusable, parameterized prompt. Inputs are parsed from `prompt`'s inline
// {{placeholder}} grammar (src/lib/workflows/template.ts) — never stored as a
// column. No cron/run-state here: those live on child `schedules`.
export const workflows = sqliteTable('workflows', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  description: text('description'),
  icon: text('icon'), // lucide icon name for the card
  prompt: text('prompt').notNull(),
  focusMode: text('focus_mode').notNull(),
  chatModel: text('chat_model', { mode: 'json' }).$type<ModelRef>().notNull(),
  systemModel: text('system_model', { mode: 'json' }).$type<ModelRef | null>(),
  selectedSystemPromptIds: text('selected_system_prompt_ids', { mode: 'json' })
    .$type<string[]>()
    .default(sql`'[]'`),
  selectedMethodologyId: text('selected_methodology_id'),
  createdAt: integer('created_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

// A cron-fired child of a workflow carrying a saved input fill-set. A workflow
// may have many schedules; each inherits the workflow's focus/models and
// overrides only its fill-set + cron + retention.
export const schedules = sqliteTable('schedules', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  workflowId: text('workflow_id')
    .notNull()
    .references(() => workflows.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  inputValues: text('input_values', { mode: 'json' })
    .$type<Record<string, string | string[]>>()
    .default(sql`'{}'`),
  cronExpression: text('cron_expression').notNull(),
  timezone: text('timezone'),
  enabled: integer('enabled')
    .notNull()
    .default(sql`1`),
  // Set when auto-disabled because a workflow edit invalidated this fill-set.
  disabledReason: text('disabled_reason'),
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
  autoMemoryEnabled: integer('auto_memory_enabled'),
  autoAcceptFileEdits: integer('auto_accept_file_edits').notNull().default(0),
  modelOverride: text('model_override', {
    mode: 'json',
  }).$type<WorkspaceModelOverride | null>(),
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

export const openaiCompatibleProviders = sqliteTable(
  'openai_compatible_providers',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    baseUrl: text('base_url').notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    supportsEmbeddings: integer('supports_embeddings', { mode: 'boolean' })
      .notNull()
      .default(false),
    headers: text('headers', { mode: 'json' })
      .$type<Record<string, string>>()
      .notNull()
      .default(sql`'{}'`),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    normalizedNameUnique: uniqueIndex(
      'openai_compatible_providers_normalized_name_unique',
    ).on(t.normalizedName),
  }),
);

export const mcpServers = sqliteTable(
  'mcp_servers',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text('name').notNull(),
    url: text('url').notNull(),
    transport: text('transport', {
      enum: ['auto', 'streamableHttp', 'sse'],
    })
      .notNull()
      .default('auto'),
    resolvedTransport: text('resolved_transport', {
      enum: ['streamableHttp', 'sse'],
    }),
    authType: text('auth_type', {
      enum: ['none', 'bearer', 'oauth_client_credentials', 'oauth'],
    })
      .notNull()
      .default('none'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    // Per-tool overrides keyed by tool name. Absent entry / absent field falls
    // back to the default (enabled + always ask). Disabled tools are filtered out
    // at injection time; `approval: 'never'` skips the approval interrupt.
    toolConfig: text('tool_config', { mode: 'json' }).$type<
      Record<string, { enabled?: boolean; approval?: 'always' | 'never' }>
    >(),
    // Whether a server scoped to specific workspaces (via mcpServerWorkspaces)
    // is also visible in unscoped (no-workspace) chats. Meaningless when the
    // server has no scope rows — an unscoped server is already visible everywhere.
    visibleInGeneralChat: integer('visible_in_general_chat', {
      mode: 'boolean',
    })
      .notNull()
      .default(false),
    headerName: text('header_name'),
    secretToken: text('secret_token'),
    // Additional request headers, sent on every transport alongside whatever
    // `authType` contributes. Some servers need a second credential header
    // (e.g. a shared gate token plus a per-user API key) that the single
    // header/token pair above can't express.
    //
    // Each *value* is encrypted individually rather than the map as a whole, so
    // the JSON structure stays visible to SQLite — that lets PATCH merge single
    // headers atomically via `json_patch` (same trick as `toolConfig`) instead
    // of a read-modify-write that would force the client to resupply every
    // secret to change one.
    extraHeaders: text('extra_headers', { mode: 'json' }).$type<
      Record<string, string>
    >(),
    oauthClientId: text('oauth_client_id'),
    oauthClientSecret: text('oauth_client_secret'),
    oauthScope: text('oauth_scope'),
    lastConnectedAt: integer('last_connected_at'),
    status: text('status', {
      enum: ['unknown', 'connected', 'auth_required', 'error', 'disabled'],
    })
      .notNull()
      .default('unknown'),
    lastError: text('last_error'),
    authFailureUntil: integer('auth_failure_until'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    nameUnique: uniqueIndex('mcp_servers_name_unique').on(t.name),
  }),
);

// Per-server workspace scope. Empty (no rows for a server) means the server is
// available in every chat, unscoped and every workspace — the unchanged
// default. A non-empty set restricts the server to those workspaces' chats,
// plus unscoped chats when `mcpServers.visibleInGeneralChat` is also true.
export const mcpServerWorkspaces = sqliteTable(
  'mcp_server_workspaces',
  {
    serverId: text('server_id')
      .notNull()
      .references(() => mcpServers.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.serverId, t.workspaceId] }),
  }),
);

// Per-server persisted OAuth credentials (access/refresh tokens, DCR result, AS
// metadata cache). Values are encrypted (src/lib/encryption.ts) at the
// provider layer (src/lib/mcp/oauth.ts), which also owns JSON
// serialization/parsing — so these columns are plain text, not `mode: 'json'`.
export const mcpOauth = sqliteTable('mcp_oauth', {
  serverId: text('server_id')
    .primaryKey()
    .references(() => mcpServers.id, { onDelete: 'cascade' }),
  clientInformation: text('client_information'),
  tokens: text('tokens'),
  // SDK saveDiscoveryState/discoveryState cache (NOT a hand-rolled metadata blob)
  discoveryState: text('discovery_state'),
  updatedAt: integer('updated_at', { mode: 'timestamp' })
    .notNull()
    .$defaultFn(() => new Date()),
});

// In-flight interactive OAuth authorization attempts — one row per attempt.
// Each attempt gets its own row so concurrent authorizations for the same server
// never clobber each other (no shared mutable state/codeVerifier column).
export const mcpOauthFlows = sqliteTable('mcp_oauth_flows', {
  // High-entropy (≥128-bit) CSRF token; also the callback lookup key
  state: text('state').primaryKey(),
  serverId: text('server_id')
    .notNull()
    .references(() => mcpServers.id, { onDelete: 'cascade' }),
  codeVerifier: text('code_verifier').notNull(),
  createdAt: integer('created_at').notNull(),
  // TTL ≤ 10 min; enforced server-side; single-use (deleted on callback success)
  expiresAt: integer('expires_at').notNull(),
});

export const approvalRequests = sqliteTable(
  'approval_requests',
  {
    id: text('id').primaryKey(),
    chatId: text('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    messageId: text('message_id').notNull(),
    threadId: text('thread_id').notNull(),
    toolCallId: text('tool_call_id').notNull(),
    engineInterruptId: text('engine_interrupt_id'),
    toolKind: text('tool_kind', {
      enum: [
        'ask_user',
        'code_execution',
        'workspace_edit',
        'workspace_create',
        'skill_edit',
        'mcp_tool',
      ],
    }).notNull(),
    workspaceId: text('workspace_id'),
    payload: text('payload', { mode: 'json' }).notNull(),
    snapshot: text('snapshot', { mode: 'json' }),
    createdAt: integer('created_at').notNull(),
    resolvedAt: integer('resolved_at'),
    resolutionKind: text('resolution_kind', {
      enum: ['user', 'cancelled', 'interrupted', 'stale_snapshot'],
    }),
    response: text('response', { mode: 'json' }),
  },
  (t) => ({
    byMessage: index('approvals_message_idx').on(t.messageId),
    byPending: index('approvals_pending_idx').on(t.resolvedAt),
    byChat: index('approvals_chat_idx').on(t.chatId),
  }),
);

export const runEvents = sqliteTable(
  'run_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    chatId: text('chat_id')
      .notNull()
      .references(() => chats.id, { onDelete: 'cascade' }),
    messageId: text('message_id').notNull(),
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    data: text('data', { mode: 'json' }).notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => ({
    byMessage: index('run_events_message_idx').on(t.messageId),
    bySeq: index('run_events_seq_idx').on(t.messageId, t.seq),
    byChat: index('run_events_chat_idx').on(t.chatId),
  }),
);

export const skills = sqliteTable(
  'skills',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text('name').notNull(),
    description: text('description').notNull(),
    content: text('content').notNull(),
    workspaceId: text('workspace_id'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    disableModelInvocation: integer('disable_model_invocation', {
      mode: 'boolean',
    })
      .notNull()
      .default(false),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    uniqByScope: uniqueIndex('skills_name_scope_uniq').on(
      t.name,
      t.workspaceId,
    ),
  }),
);

// Agent-authored HTML documents. App-level cascades (no DB FKs), matching the
// other tables here. `workspaceId` decides the owner: when set, the document
// belongs to the workspace and any of its chats may read and edit it, so
// `chatId` is only provenance (and goes NULL if that chat is deleted). When
// null, the document is chat-scoped and dies with the chat, as before.
export const artifacts = sqliteTable(
  'artifacts',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    chatId: text('chat_id'),
    workspaceId: text('workspace_id'),
    title: text('title').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    byChat: index('artifacts_chat_idx').on(t.chatId),
    byWorkspace: index('artifacts_workspace_idx').on(t.workspaceId),
  }),
);

// One immutable full snapshot per successful agent write, anchored to the
// assistant message whose tool call produced it so a rewind can drop it.
export const artifactVersions = sqliteTable(
  'artifact_versions',
  {
    id: text('id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    artifactId: text('artifact_id').notNull(),
    messageId: text('message_id').notNull(),
    // 1-based and dense, so the switcher can show "v3 of 7" without counting.
    version: integer('version').notNull(),
    content: text('content').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    uniqVersion: uniqueIndex('uniq_artifact_version').on(
      t.artifactId,
      t.version,
    ),
    byMessage: index('artifact_versions_message_idx').on(t.messageId),
  }),
);

// Generated images are durable only when created by a top-level chat turn.
// Existing files in uploads/ have no rows here by design, so they are never
// eligible for history or lifecycle cleanup.
export const generatedImages = sqliteTable(
  'generated_images',
  {
    id: text('id').primaryKey(),
    extension: text('extension').notNull(),
    mimeType: text('mime_type').notNull(),
    prompt: text('prompt').notNull(),
    assistantMessageId: text('assistant_message_id').notNull(),
    chatId: text('chat_id'),
    workspaceId: text('workspace_id'),
    createdAt: integer('created_at', { mode: 'timestamp' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (t) => ({
    byChat: index('generated_images_chat_idx').on(t.chatId),
    byWorkspace: index('generated_images_workspace_idx').on(t.workspaceId),
    byMessage: index('generated_images_message_idx').on(t.assistantMessageId),
  }),
);
