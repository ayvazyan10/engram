CREATE TABLE `local_meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`pull_cursor` text,
	`last_push_at` text,
	`last_sync_at` text,
	`last_error` text,
	`embedding_model` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`secret` text,
	`events` text DEFAULT '[]' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`description` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_triggered_at` text,
	`fail_count` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_webhooks_active` ON `webhooks` (`active`);--> statement-breakpoint
ALTER TABLE `memories` ADD `embedding_model` text;--> statement-breakpoint
ALTER TABLE `memories` ADD `namespace` text;--> statement-breakpoint
ALTER TABLE `memories` ADD `device_id` text;--> statement-breakpoint
CREATE INDEX `idx_memories_namespace` ON `memories` (`namespace`);--> statement-breakpoint
CREATE INDEX `idx_memories_updated_at` ON `memories` (`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_memories_sync_push` ON `memories` (`device_id`,`updated_at`,`id`);--> statement-breakpoint
ALTER TABLE `memory_connections` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `memory_connections` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `memory_connections` ADD `device_id` text;--> statement-breakpoint
CREATE INDEX `idx_connections_deleted_at` ON `memory_connections` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_connections_updated_at` ON `memory_connections` (`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_connections_sync_push` ON `memory_connections` (`device_id`,`updated_at`,`id`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `updated_at` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `deleted_at` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `device_id` text;--> statement-breakpoint
CREATE INDEX `idx_sessions_deleted_at` ON `sessions` (`deleted_at`);--> statement-breakpoint
CREATE INDEX `idx_sessions_sync_push` ON `sessions` (`device_id`,`updated_at`,`id`);