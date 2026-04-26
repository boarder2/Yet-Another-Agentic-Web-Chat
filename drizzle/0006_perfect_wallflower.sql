CREATE TABLE `workspace_files` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`mime` text,
	`size` integer NOT NULL,
	`sha256` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_workspace_file_name` ON `workspace_files` (`workspace_id`,`name`);--> statement-breakpoint
CREATE TABLE `workspace_system_prompts` (
	`workspace_id` text NOT NULL,
	`system_prompt_id` text NOT NULL,
	`order` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`workspace_id`, `system_prompt_id`)
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`color` text,
	`icon` text,
	`instructions` text,
	`source_urls` text DEFAULT '[]',
	`chat_model` text NOT NULL,
	`system_model` text,
	`default_focus_mode` text,
	`auto_memory_enabled` integer,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `chats` ADD `workspace_id` text;--> statement-breakpoint
ALTER TABLE `memories` ADD `workspace_id` text;