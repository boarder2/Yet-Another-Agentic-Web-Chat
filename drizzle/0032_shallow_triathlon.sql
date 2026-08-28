CREATE TABLE `map_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `map_cache_expiry_idx` ON `map_cache` (`expires_at`);--> statement-breakpoint
CREATE INDEX `map_cache_kind_idx` ON `map_cache` (`kind`);