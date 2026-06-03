CREATE TABLE `approval_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`message_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`tool_call_id` text NOT NULL,
	`engine_interrupt_id` text,
	`tool_kind` text NOT NULL,
	`workspace_id` text,
	`payload` text NOT NULL,
	`snapshot` text,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	`resolution_kind` text,
	`response` text,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `approvals_message_idx` ON `approval_requests` (`message_id`);--> statement-breakpoint
CREATE INDEX `approvals_pending_idx` ON `approval_requests` (`resolved_at`);--> statement-breakpoint
CREATE INDEX `approvals_chat_idx` ON `approval_requests` (`chat_id`);--> statement-breakpoint
CREATE TABLE `run_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chat_id` text NOT NULL,
	`message_id` text NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `run_events_message_idx` ON `run_events` (`message_id`);--> statement-breakpoint
CREATE INDEX `run_events_seq_idx` ON `run_events` (`message_id`,`seq`);--> statement-breakpoint
CREATE INDEX `run_events_chat_idx` ON `run_events` (`chat_id`);--> statement-breakpoint
ALTER TABLE `chats` ADD `active_run_status` text;--> statement-breakpoint
ALTER TABLE `chats` ADD `active_run_thread_id` text;--> statement-breakpoint
ALTER TABLE `chats` ADD `active_run_config_snapshot` text;