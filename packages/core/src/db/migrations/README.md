# SQLite migrations — tooling only, not the runtime path

**Engram opens SQLite without applying the SQL files in this folder.**
`runSqliteMigrations()` in [`../adapter.ts`](../adapter.ts) creates or upgrades
the schema whenever an Engram process opens a SQLite connection. Developers can
also apply the checked-in SQL explicitly with `pnpm db:migrate`.

Two facts make that concrete, and both are worth re-checking before trusting
anything here:

- **Not published.** `packages/core/package.json` ships `files: ["dist"]`, and the
  `copy:pg-migrations` build step copies only `src/db/pg/migrations` into `dist`.
  This folder never leaves the repo.
- **Not applied at runtime.** `src/db/pg/migrate.ts` reads the **Postgres**
  migrations. The SQLite parity test applies this folder's SQL to its own test
  database. CI also runs `pnpm db:generate && pnpm db:migrate` against a
  throwaway `/tmp` file.

## Why the folder exists at all

`drizzle-kit generate` writes the SQL and a schema snapshot here. The SQL is an
executable rendering of what [`../schema.ts`](../schema.ts) claims the
database looks like. `schema.ts` is also where `$inferSelect` / `$inferInsert`
come from, so a divergence there is a lie the type checker believes.

## `0000`'s snapshot was repaired, not squashed

`0000_cynical_marauders.sql` creates `namespace` (and its index) on
`context_assemblies` and `sessions`, but `meta/0000_snapshot.json` did not record
either. The two halves of one migration contradicted each other, which meant
**every** migration `generate` produced from that snapshot was unappliable — it
re-added a column `0000` had already created (`duplicate column name: namespace`).
The mismatch was still present in v0.6.5.

The snapshot was hand-corrected to describe the SQL it shipped with, and `0001`
was then generated normally. The repair left `0000_cynical_marauders.sql`
untouched, so the ~30 test suites that read the first `.sql` in this directory
continue to use the same base schema DDL.

Do not hand-edit a snapshot again except to correct a demonstrable
snapshot-vs-SQL contradiction, and only with proof: after any such edit,
`drizzle-kit generate` must emit a migration that applies cleanly on top of the
existing chain, and a second `generate` must report no changes.

## Keeping the two descriptions in step

[`../__tests__/sqlite-schema-parity.test.ts`](../__tests__/sqlite-schema-parity.test.ts)
builds one database from these migrations and one from `runSqliteMigrations`, and
diffs tables, columns and index names. **If you change either side, run it.**
A schema change needs matching tooling and runtime DDL.

Regenerating after a `schema.ts` change:

```sh
pnpm --filter @engram-ai-memory/core exec drizzle-kit generate
```

## FTS5 custom migration

`0002_memory_fts.sql` was created with `drizzle-kit generate --custom
--name=memory_fts`, which registers the journal entry and an unchanged schema
snapshot. Drizzle cannot represent FTS5 virtual tables or triggers. Its SQL is
mirrored by `runMemoryFtsMigration()` in `adapter.ts`, called after the base
runtime migrations on both fresh and existing databases. Creation, triggers,
and the initial `rebuild` backfill run in one transaction. The external-content
index includes archived rows; retrieval excludes them through `memories.archived_at`.
