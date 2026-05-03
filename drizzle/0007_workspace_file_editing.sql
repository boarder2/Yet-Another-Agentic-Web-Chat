ALTER TABLE `workspace_files` ADD `auto_accept_edits` integer;--> statement-breakpoint
ALTER TABLE `workspaces` ADD `auto_accept_file_edits` integer DEFAULT 0 NOT NULL;