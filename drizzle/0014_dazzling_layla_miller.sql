CREATE TABLE `tts_narrations` (
	`message_id` text PRIMARY KEY NOT NULL,
	`content_hash` text NOT NULL,
	`narration` text NOT NULL,
	`created_at` integer NOT NULL
);
