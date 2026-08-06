CREATE TABLE `artifact_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`artifact_id` text NOT NULL,
	`message_id` text NOT NULL,
	`version` integer NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_artifact_version` ON `artifact_versions` (`artifact_id`,`version`);--> statement-breakpoint
CREATE INDEX `artifact_versions_message_idx` ON `artifact_versions` (`message_id`);--> statement-breakpoint
CREATE TABLE `artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text,
	`workspace_id` text,
	`title` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `artifacts_chat_idx` ON `artifacts` (`chat_id`);--> statement-breakpoint
CREATE INDEX `artifacts_workspace_idx` ON `artifacts` (`workspace_id`);