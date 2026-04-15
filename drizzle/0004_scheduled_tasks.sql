CREATE TABLE `scheduled_tasks` (
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
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `chats` ADD `scheduled_task_id` text;
--> statement-breakpoint
ALTER TABLE `chats` ADD `scheduled_run_viewed` integer;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `chats_scheduled_run_viewed_idx` ON `chats`(`scheduled_run_viewed`);
