PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_chats` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`createdAt` integer NOT NULL,
	`focusMode` text NOT NULL,
	`files` text DEFAULT '[]',
	`is_private` integer DEFAULT 0 NOT NULL,
	`scheduled_task_id` text,
	`scheduled_run_viewed` integer,
	`pinned` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_chats`("id", "title", "createdAt", "focusMode", "files", "is_private", "scheduled_task_id", "scheduled_run_viewed", "pinned") SELECT "id", "title", "createdAt", "focusMode", "files", "is_private", "scheduled_task_id", "scheduled_run_viewed", "pinned" FROM `chats`;--> statement-breakpoint
DROP TABLE `chats`;--> statement-breakpoint
ALTER TABLE `__new_chats` RENAME TO `chats`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_scheduled_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`prompt` text NOT NULL,
	`focus_mode` text NOT NULL,
	`source_urls` text DEFAULT '[]',
	`chat_model` text NOT NULL,
	`system_model` text,
	`embedding_model` text NOT NULL,
	`selected_system_prompt_ids` text DEFAULT '[]',
	`selected_methodology_id` text,
	`cron_expression` text NOT NULL,
	`timezone` text,
	`enabled` integer DEFAULT 1 NOT NULL,
	`last_run_at` integer,
	`last_run_status` text,
	`last_run_error` text,
	`last_run_chat_id` text,
	`retention_mode` text,
	`retention_value` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_scheduled_tasks`("id", "name", "prompt", "focus_mode", "source_urls", "chat_model", "system_model", "embedding_model", "selected_system_prompt_ids", "selected_methodology_id", "cron_expression", "timezone", "enabled", "last_run_at", "last_run_status", "last_run_error", "last_run_chat_id", "retention_mode", "retention_value", "created_at", "updated_at") SELECT "id", "name", "prompt", "focus_mode", "source_urls", "chat_model", "system_model", "embedding_model", "selected_system_prompt_ids", "selected_methodology_id", "cron_expression", "timezone", "enabled", "last_run_at", "last_run_status", "last_run_error", "last_run_chat_id", "retention_mode", "retention_value", "created_at", "updated_at" FROM `scheduled_tasks`;--> statement-breakpoint
DROP TABLE `scheduled_tasks`;--> statement-breakpoint
ALTER TABLE `__new_scheduled_tasks` RENAME TO `scheduled_tasks`;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `chats_scheduled_run_viewed_idx` ON `chats`(`scheduled_run_viewed`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `chats_pinned_idx` ON `chats`(`pinned`);