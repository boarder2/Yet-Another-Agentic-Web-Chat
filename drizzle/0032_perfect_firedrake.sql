CREATE TABLE `openai_compatible_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`base_url` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`supports_embeddings` integer DEFAULT false NOT NULL,
	`headers` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `openai_compatible_providers_normalized_name_unique` ON `openai_compatible_providers` (`normalized_name`);