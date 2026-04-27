PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_chats` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`createdAt` integer NOT NULL,
	`focusMode` text NOT NULL,
	`files` text DEFAULT '[]',
	`is_private` integer DEFAULT 0 NOT NULL,
	`scheduled_task_id` text,
	`scheduled_run_viewed` integer,
	`pinned` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_chats`("id", "title", "createdAt", "focusMode", "files", "is_private", "scheduled_task_id", "scheduled_run_viewed", "pinned")
SELECT
	"id",
	"title",
	CASE typeof("createdAt")
		WHEN 'text' THEN CAST(
			(julianday(
				substr("createdAt", 12, 4) || '-' ||
				CASE substr("createdAt", 5, 3)
					WHEN 'Jan' THEN '01' WHEN 'Feb' THEN '02' WHEN 'Mar' THEN '03'
					WHEN 'Apr' THEN '04' WHEN 'May' THEN '05' WHEN 'Jun' THEN '06'
					WHEN 'Jul' THEN '07' WHEN 'Aug' THEN '08' WHEN 'Sep' THEN '09'
					WHEN 'Oct' THEN '10' WHEN 'Nov' THEN '11' WHEN 'Dec' THEN '12'
				END || '-' ||
				substr("createdAt", 9, 2) || 'T' ||
				substr("createdAt", 17, 8)
			) - 2440587.5) * 86400000 AS INTEGER)
		ELSE "createdAt"
	END,
	"focusMode",
	"files",
	"is_private",
	"scheduled_task_id",
	"scheduled_run_viewed",
	0
FROM `chats`;--> statement-breakpoint
DROP TABLE `chats`;--> statement-breakpoint
ALTER TABLE `__new_chats` RENAME TO `chats`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `scheduled_tasks` ADD COLUMN `retention_mode` text;--> statement-breakpoint
ALTER TABLE `scheduled_tasks` ADD COLUMN `retention_value` integer;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `chats_scheduled_run_viewed_idx` ON `chats`(`scheduled_run_viewed`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `chats_pinned_idx` ON `chats`(`pinned`);