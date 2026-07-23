CREATE TABLE `schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_id` text NOT NULL,
	`label` text NOT NULL,
	`input_values` text DEFAULT '{}',
	`cron_expression` text NOT NULL,
	`timezone` text,
	`enabled` integer DEFAULT 1 NOT NULL,
	`disabled_reason` text,
	`last_run_at` integer,
	`last_run_status` text,
	`last_run_error` text,
	`last_run_chat_id` text,
	`retention_mode` text,
	`retention_value` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`icon` text,
	`prompt` text NOT NULL,
	`focus_mode` text NOT NULL,
	`chat_model` text NOT NULL,
	`system_model` text,
	`selected_system_prompt_ids` text DEFAULT '[]',
	`selected_methodology_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `chats` ADD `schedule_id` text;--> statement-breakpoint
ALTER TABLE `chats` ADD `workflow_id` text;