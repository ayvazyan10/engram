# SQLite migrations — tooling only, not the runtime path

**Nothing in this folder ever runs on a user's machine.** `runSqliteMigrations()`
in [`../adapter.ts`](../adapter.ts) is the runtime source of truth: it executes on
every connection open, in every process (REST server, MCP server, CLI), and it is
the only thing that has ever created or upgraded an `engram.db`.

Two facts make that concrete, and both are worth re-checking before trusting
anything here:

- **Not published.** `packages/core/package.json` ships `files: ["dist"]`, and the
  `copy:pg-migrations` build step copies only `src/db/pg/migrations` into `dist`.
  This folder never leaves the repo.
- **Not applied at runtime.** The only `migrationsFolder` caller in this package
  is `src/db/pg/migrate.ts`, and it points at the **Postgres** folder. CI does run
  `pnpm db:generate && pnpm db:migrate` against a throwaway `/tmp` file, which is
  what keeps these files honest.

## Why the folder exists at all

`drizzle-kit generate` needs somewhere to write, and the generated SQL is the only
machine-checkable rendering of what [`../schema.ts`](../schema.ts) claims the
database looks like. `schema.ts` is also where `$inferSelect` / `$inferInsert`
come from, so a divergence there is a lie the type checker believes.

## `0000`'s snapshot was repaired, not squashed

`0000_cynical_marauders.sql` creates `namespace` (and its index) on
`context_assemblies` and `sessions`, but `meta/0000_snapshot.json` did not record
either. The two halves of one migration contradicted each other, which meant
**every** migration `generate` produced from that snapshot was unappliable — it
re-added a column `0000` had already created (`duplicate column name: namespace`).
Because nothing applies these files at runtime, that had gone unnoticed for four
releases.

The snapshot was hand-corrected to describe the SQL it shipped with, and `0001`
was then generated normally. `0000_cynical_marauders.sql` itself is untouched and
byte-identical to what it has always been — deliberately, because ~30 test suites
across this package read the first `.sql` in this directory as their base schema
DDL. Squashing the folder would have broken all of them, so the "generated output
can't be trusted" finding was resolved by making the chain correct rather than by
discarding it.

Do not hand-edit a snapshot again except to correct a demonstrable
snapshot-vs-SQL contradiction, and only with proof: after any such edit,
`drizzle-kit generate` must emit a migration that applies cleanly on top of the
existing chain, and a second `generate` must report no changes.

## Keeping the two descriptions in step

[`../__tests__/sqlite-schema-parity.test.ts`](../__tests__/sqlite-schema-parity.test.ts)
builds one database from these migrations and one from `runSqliteMigrations`, and
diffs tables, columns and index names. **If you change either side, run it.**
Changing `adapter.ts` without changing `schema.ts` (or the reverse) fails there.

Regenerating after a `schema.ts` change:

```sh
pnpm --filter @engram-ai-memory/core exec drizzle-kit generate
```
