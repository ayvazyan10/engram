-- Frozen fixture: the v0.1.0 SQLite schema, exactly as the very first
-- released build created it. No `namespace` on any table, no
-- `embedding_model`, no `webhooks`/`local_meta`/`sync_state`.
--
-- This used to be derived at test time from
-- `src/db/migrations/0000_cynical_marauders.sql` by stripping columns back
-- out of it. That only worked while that file happened to be four releases
-- stale — the migrations folder tracks the CURRENT schema, so it can never be
-- a dependable description of history. History does not change, so it is
-- checked in here instead.
--
-- Do not "update" this file to match schema.ts. Upgrade steps applied after
-- v0.1.0 belong in the test's own createV040Db(), next to the runtime
-- migration they mirror.

CREATE TABLE `context_assemblies` (
	`id` text PRIMARY KEY NOT NULL,
	`query` text NOT NULL,
	`query_embedding` blob,
	`assembled_context` text NOT NULL,
	`source` text,
	`session_id` text,
	`latency_ms` integer,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_assemblies_source` ON `context_assemblies` (`source`);
--> statement-breakpoint
CREATE INDEX `idx_assemblies_session` ON `context_assemblies` (`session_id`);
--> statement-breakpoint
CREATE INDEX `idx_assemblies_created` ON `context_assemblies` (`created_at`);
--> statement-breakpoint
CREATE TABLE `memories` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`summary` text,
	`embedding` blob,
	`embedding_dim` integer DEFAULT 384 NOT NULL,
	`importance` real DEFAULT 0.5 NOT NULL,
	`confidence` real DEFAULT 1 NOT NULL,
	`access_count` integer DEFAULT 0 NOT NULL,
	`last_accessed_at` text,
	`event_at` text,
	`session_id` text,
	`source` text,
	`concept` text,
	`trigger_pattern` text,
	`action_pattern` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`archived_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_memories_type` ON `memories` (`type`);
--> statement-breakpoint
CREATE INDEX `idx_memories_source` ON `memories` (`source`);
--> statement-breakpoint
CREATE INDEX `idx_memories_importance` ON `memories` (`importance`);
--> statement-breakpoint
CREATE INDEX `idx_memories_session` ON `memories` (`session_id`);
--> statement-breakpoint
CREATE INDEX `idx_memories_concept` ON `memories` (`concept`);
--> statement-breakpoint
CREATE INDEX `idx_memories_archived` ON `memories` (`archived_at`);
--> statement-breakpoint
CREATE TABLE `memory_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`target_id` text NOT NULL,
	`relationship` text NOT NULL,
	`strength` real DEFAULT 1 NOT NULL,
	`bidirectional` integer DEFAULT false NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `memories`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_id`) REFERENCES `memories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_connections_source` ON `memory_connections` (`source_id`);
--> statement-breakpoint
CREATE INDEX `idx_connections_target` ON `memory_connections` (`target_id`);
--> statement-breakpoint
CREATE INDEX `idx_connections_relationship` ON `memory_connections` (`relationship`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_connections_unique_pair` ON `memory_connections` (`source_id`,`target_id`,`relationship`);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`context` text,
	`started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`ended_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_source` ON `sessions` (`source`);
--> statement-breakpoint
CREATE INDEX `idx_sessions_started` ON `sessions` (`started_at`);
