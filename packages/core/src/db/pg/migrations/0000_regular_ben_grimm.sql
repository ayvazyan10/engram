CREATE TABLE "memories" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"content" text NOT NULL,
	"summary" text,
	"embedding" "bytea",
	"embedding_dim" integer DEFAULT 384 NOT NULL,
	"embedding_model" text,
	"importance" real DEFAULT 0.5 NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL,
	"access_count" integer DEFAULT 0 NOT NULL,
	"last_accessed_at" text,
	"event_at" text,
	"session_id" text,
	"source" text,
	"concept" text,
	"trigger_pattern" text,
	"action_pattern" text,
	"namespace" text,
	"metadata" text DEFAULT '{}' NOT NULL,
	"tags" text DEFAULT '[]' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"archived_at" text,
	"device_id" text,
	"server_updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"source_id" text NOT NULL,
	"target_id" text NOT NULL,
	"relationship" text NOT NULL,
	"strength" real DEFAULT 1 NOT NULL,
	"bidirectional" boolean DEFAULT false NOT NULL,
	"metadata" text DEFAULT '{}' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text,
	"deleted_at" text,
	"device_id" text,
	"server_updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"context" text,
	"namespace" text,
	"started_at" text NOT NULL,
	"ended_at" text,
	"updated_at" text,
	"deleted_at" text,
	"device_id" text,
	"server_updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memory_connections" ADD CONSTRAINT "memory_connections_source_id_memories_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_connections" ADD CONSTRAINT "memory_connections_target_id_memories_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_pg_memories_server_updated_at" ON "memories" USING btree ("server_updated_at");--> statement-breakpoint
CREATE INDEX "idx_pg_memories_namespace" ON "memories" USING btree ("namespace");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_pg_connections_unique_pair" ON "memory_connections" USING btree ("source_id","target_id","relationship");--> statement-breakpoint
CREATE INDEX "idx_pg_connections_server_updated_at" ON "memory_connections" USING btree ("server_updated_at");--> statement-breakpoint
CREATE INDEX "idx_pg_sessions_server_updated_at" ON "sessions" USING btree ("server_updated_at");