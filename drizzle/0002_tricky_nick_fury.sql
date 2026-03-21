CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text DEFAULT 'default' NOT NULL,
	`content` text NOT NULL,
	`embedding` text,
	`embedding_model` text,
	`category` text,
	`source_type` text,
	`source_chat_id` text,
	`access_count` integer DEFAULT 0 NOT NULL,
	`last_accessed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
