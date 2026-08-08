CREATE TABLE `generated_images` (
	`id` text PRIMARY KEY NOT NULL,
	`extension` text NOT NULL,
	`mime_type` text NOT NULL,
	`prompt` text NOT NULL,
	`assistant_message_id` text NOT NULL,
	`chat_id` text,
	`workspace_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `generated_images_chat_idx` ON `generated_images` (`chat_id`);--> statement-breakpoint
CREATE INDEX `generated_images_workspace_idx` ON `generated_images` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `generated_images_message_idx` ON `generated_images` (`assistant_message_id`);