CREATE TABLE `mcp_server_workspaces` (
	`server_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	PRIMARY KEY(`server_id`, `workspace_id`),
	FOREIGN KEY (`server_id`) REFERENCES `mcp_servers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `mcp_servers` ADD `visible_in_general_chat` integer DEFAULT false NOT NULL;