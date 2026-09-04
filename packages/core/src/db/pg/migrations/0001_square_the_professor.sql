-- HAND-EDITED: `IF NOT EXISTS` was added to the CREATE statements below.
-- drizzle-kit never emits it, and re-running `drizzle-kit generate` will not
-- put it back — keep it if you regenerate this file.
--
-- Why: `sync_metadata` shipped for several releases as out-of-band DDL in
-- ../migrate.ts (`createSyncMetadataTable`, a plain CREATE TABLE IF NOT
-- EXISTS run after `migrate()`), so every sync database in the wild already
-- has the table while recording only `0000` as applied. Adopting it into the
-- migration set means this file runs against those databases, and drizzle's
-- migrator runs BEFORE any out-of-band DDL — so an unqualified CREATE TABLE
-- here fails with `relation "sync_metadata" already exists` on every
-- existing database, on every connect. See
-- __tests__/pg-migrate-upgrade.test.ts, which reproduces exactly that.
--
-- Only the .sql is edited. meta/0001_snapshot.json stays byte-for-byte as
-- drizzle-kit produced it: the snapshot is what `generate` diffs against, the
-- .sql is what actually runs. Editing the snapshot would make the next
-- `generate` emit a phantom migration.
CREATE TABLE IF NOT EXISTS "sync_metadata" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
-- Widening only. Values already written as float4 stay rounded (0.7 is on
-- disk as 0.699999988079071); nothing can recover those digits, they are
-- corrected the next time a device pushes the row.
ALTER TABLE "memories" ALTER COLUMN "importance" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "memories" ALTER COLUMN "confidence" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "memory_connections" ALTER COLUMN "strength" SET DATA TYPE double precision;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pg_memories_device_id" ON "memories" USING btree ("device_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pg_connections_target_id" ON "memory_connections" USING btree ("target_id");
