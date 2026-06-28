CREATE TABLE `mcp_oauth` (
	`server_id` text PRIMARY KEY NOT NULL,
	`client_information` text,
	`tokens` text,
	`discovery_state` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `mcp_servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `mcp_oauth_flows` (
	`state` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`code_verifier` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `mcp_servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `mcp_servers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`transport` text DEFAULT 'auto' NOT NULL,
	`resolved_transport` text,
	`auth_type` text DEFAULT 'none' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`header_name` text,
	`secret_token` text,
	`oauth_client_id` text,
	`oauth_client_secret` text,
	`oauth_scope` text,
	`last_connected_at` integer,
	`status` text DEFAULT 'unknown' NOT NULL,
	`last_error` text,
	`auth_failure_until` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_servers_name_unique` ON `mcp_servers` (`name`);