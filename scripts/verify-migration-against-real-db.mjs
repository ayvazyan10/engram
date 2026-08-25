#!/usr/bin/env node
/**
 * Verify the v0.5.0 sync-foundation migration against a REAL database.
 *
 * This is intentionally NOT a vitest test: it depends on a private database
 * file that does not exist in CI (a copy of a user's engram.db). It is meant
 * to be run by hand — locally, or against a fresh backup — whenever a schema
 * migration lands, to catch anything synthetic fixtures wouldn't (existing
 * NULLs, real row volume, real embedding blobs).
 *
 * Usage:
 *   node scripts/verify-migration-against-real-db.mjs <path-to-a-database-file>
 *
 * Safety:
 *   - The input file is only ever READ. This script copies it to a temp path
 *     under the OS/session temp directory and operates exclusively on the copy.
 *   - Refuses to run at all if the resolved input path looks like the user's
 *     live database (~/.engram/engram.db) or the repo-root engram.db.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const CORE_DIR = path.join(REPO_ROOT, 'packages', 'core');

// Resolve better-sqlite3 the same way packages/core itself would (pnpm's
// strict, non-hoisted node_modules means it usually isn't visible from
// scripts/ directly).
const requireFromCore = createRequire(path.join(CORE_DIR, 'package.json'));
const Database = requireFromCore('better-sqlite3');

// ─── Guard rails ────────────────────────────────────────────────────────────

// Compare canonicalized paths: path.resolve() alone does NOT follow symlinks,
// so a link pointing at the live database would slip past a lexical denylist.
// realpathSync also normalizes case on case-insensitive filesystems.
function canonical(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

const FORBIDDEN_PATHS = [
  path.join(os.homedir(), '.engram', 'engram.db'),
  path.join(REPO_ROOT, 'engram.db'),
].map(canonical);

function fail(message) {
  console.error(`\n[FAIL] ${message}`);
  process.exit(1);
}

const inputArg = process.argv[2];
if (!inputArg) {
  fail('Usage: node scripts/verify-migration-against-real-db.mjs <path-to-a-database-file>');
}

const inputPath = path.resolve(inputArg);

if (!fs.existsSync(inputPath)) {
  fail(`Input file does not exist: ${inputPath}`);
}

const canonicalInput = canonical(inputPath);

for (const forbidden of FORBIDDEN_PATHS) {
  if (canonicalInput === forbidden) {
    fail(
      `Refusing to operate on ${inputPath} — this looks like a live/primary database, not a disposable copy.\n` +
      `Point this script at a BACKUP file instead (this script copies it before touching anything).`
    );
  }
}

// ─── Set up an isolated working copy ───────────────────────────────────────

const SCRATCH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'engram-migration-verify-'));
const copyPath = path.join(SCRATCH_DIR, 'copy.db');
const freshPath = path.join(SCRATCH_DIR, 'fresh.db');

fs.copyFileSync(inputPath, copyPath);
// Bring along WAL/SHM siblings if present, so the copy reflects the exact
// on-disk state (uncheckpointed writes included).
for (const suffix of ['-wal', '-shm']) {
  const siblingSrc = inputPath + suffix;
  if (fs.existsSync(siblingSrc)) {
    fs.copyFileSync(siblingSrc, copyPath + suffix);
  }
}

console.log(`[info] Source (read-only):  ${inputPath}`);
console.log(`[info] Working copy:        ${copyPath}`);
console.log(`[info] Fresh comparison DB: ${freshPath}`);

let exitCode = 0;
const problems = [];

function record(label, ok, detail) {
  if (ok) {
    console.log(`[PASS] ${label}`);
  } else {
    console.log(`[FAIL] ${label}${detail ? ` — ${detail}` : ''}`);
    problems.push(label + (detail ? ` — ${detail}` : ''));
    exitCode = 1;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function listTables(dbFile) {
  const db = new Database(dbFile, { readonly: true });
  try {
    return db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map((r) => r.name)
      .sort();
  } finally {
    db.close();
  }
}

function rowCounts(dbFile, tables) {
  const db = new Database(dbFile, { readonly: true });
  try {
    const counts = {};
    for (const table of tables) {
      counts[table] = db.prepare(`SELECT COUNT(*) as cnt FROM "${table}"`).get().cnt;
    }
    return counts;
  } finally {
    db.close();
  }
}

function tableInfo(dbFile, table) {
  const db = new Database(dbFile, { readonly: true });
  try {
    return db.prepare(`PRAGMA table_info("${table}")`).all();
  } finally {
    db.close();
  }
}

function sampleMemories(dbFile, limit = 20) {
  const db = new Database(dbFile, { readonly: true });
  try {
    const hasMemories = db
      .prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='memories'")
      .get().cnt;
    if (!hasMemories) return [];
    return db
      .prepare(
        `SELECT id, content, embedding, embedding_model, namespace, created_at, updated_at
         FROM memories ORDER BY id LIMIT ?`
      )
      .all(limit);
  } finally {
    db.close();
  }
}

function hashBlob(value) {
  if (value === null || value === undefined) return null;
  if (Buffer.isBuffer(value)) return crypto.createHash('sha256').update(value).digest('hex');
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

// ─── 1. Snapshot BEFORE migration ──────────────────────────────────────────

console.log('\n=== Pre-migration snapshot ===');
const tablesBefore = listTables(copyPath);
console.log(`[info] Tables before: ${tablesBefore.join(', ')}`);
const countsBefore = rowCounts(copyPath, tablesBefore);
for (const [table, count] of Object.entries(countsBefore)) {
  console.log(`[info]   ${table}: ${count} rows`);
}
const sampleBefore = sampleMemories(copyPath, 20);
console.log(`[info] Sampled ${sampleBefore.length} memories rows for byte-comparison`);

// ─── 2. Run the migration through the REAL adapter code path ──────────────

console.log('\n=== Running migration via the normal adapter path ===');
process.env.ENGRAM_DB_PATH = copyPath;
process.env.ENGRAM_DATABASE = 'sqlite';

const { getDatabaseConnection, closeDb } = await import(
  path.join(CORE_DIR, 'dist', 'index.js')
);

getDatabaseConnection({ dialect: 'sqlite', sqlitePath: copyPath });
closeDb();
console.log('[info] Migration executed and connection closed.');

// Also produce a fresh, brand-new DB through the same code path, for the
// table_info equivalence check.
getDatabaseConnection({ dialect: 'sqlite', sqlitePath: freshPath });
closeDb();

// ─── 3. Assertions ──────────────────────────────────────────────────────────

console.log('\n=== Verifying ===');

const tablesAfter = listTables(copyPath);
const countsAfter = rowCounts(copyPath, tablesAfter);

// 3a. Row counts unchanged for every table that existed before.
for (const table of tablesBefore) {
  record(
    `row count unchanged: ${table}`,
    countsBefore[table] === countsAfter[table],
    `before=${countsBefore[table]} after=${countsAfter[table]}`
  );
}

// 3b. Sampled rows byte-for-byte unchanged (embedding blob included).
const sampleAfterById = new Map(sampleMemories(copyPath, 100000).map((r) => [r.id, r]));
let sampleMismatches = 0;
for (const before of sampleBefore) {
  const after = sampleAfterById.get(before.id);
  if (!after) {
    sampleMismatches++;
    console.log(`[FAIL]   row ${before.id} missing after migration`);
    continue;
  }
  const fields = ['content', 'embedding_model', 'namespace', 'created_at', 'updated_at'];
  for (const field of fields) {
    if (before[field] !== after[field]) {
      sampleMismatches++;
      console.log(`[FAIL]   row ${before.id}.${field} changed: ${JSON.stringify(before[field])} -> ${JSON.stringify(after[field])}`);
    }
  }
  if (hashBlob(before.embedding) !== hashBlob(after.embedding)) {
    sampleMismatches++;
    console.log(`[FAIL]   row ${before.id}.embedding blob changed`);
  }
}
record(
  `sampled rows (${sampleBefore.length}) byte-for-byte unchanged`,
  sampleMismatches === 0,
  sampleMismatches > 0 ? `${sampleMismatches} field/row mismatches` : undefined
);

// 3c. New v0.5.0 columns exist and are NULL on pre-existing rows.
const newColumns = {
  memories: ['device_id'],
  memory_connections: ['updated_at', 'deleted_at', 'device_id'],
  sessions: ['updated_at', 'deleted_at', 'device_id'],
};

for (const [table, columns] of Object.entries(newColumns)) {
  if (!tablesAfter.includes(table)) {
    record(`table exists: ${table}`, false, 'missing entirely');
    continue;
  }
  const info = tableInfo(copyPath, table);
  const colNames = info.map((c) => c.name);
  for (const column of columns) {
    const present = colNames.includes(column);
    record(`column exists: ${table}.${column}`, present);
    if (present && countsBefore[table] > 0) {
      const db = new Database(copyPath, { readonly: true });
      try {
        const nonNull = db
          .prepare(`SELECT COUNT(*) as cnt FROM "${table}" WHERE "${column}" IS NOT NULL`)
          .get().cnt;
        record(
          `${table}.${column} is NULL on all pre-existing rows`,
          nonNull === 0,
          nonNull > 0 ? `${nonNull} non-NULL values found (write paths must not populate this yet)` : undefined
        );
      } finally {
        db.close();
      }
    }
  }
}

// 3d. Both new tables exist.
for (const table of ['local_meta', 'sync_state']) {
  record(`new table exists: ${table}`, tablesAfter.includes(table));
}

// 3e. PRAGMA table_info matches a freshly created database, for every table
// common to both (mirrors packages/core/src/db/__tests__/migration-v050.test.ts).
const freshTables = listTables(freshPath);
const commonTables = tablesAfter.filter((t) => freshTables.includes(t));
for (const table of commonTables) {
  const before = JSON.stringify(tableInfo(freshPath, table));
  const after = JSON.stringify(tableInfo(copyPath, table));
  record(`table_info matches fresh DB: ${table}`, before === after);
}
// Tables present in the real DB but not in the schema at all would be surprising;
// call it out rather than silently ignoring it.
const unknownTables = tablesAfter.filter((t) => !freshTables.includes(t));
if (unknownTables.length > 0) {
  console.log(`[warn] Tables in the real DB with no fresh-schema counterpart: ${unknownTables.join(', ')}`);
}

// ─── Summary ────────────────────────────────────────────────────────────────

console.log('\n=== Summary ===');
if (exitCode === 0) {
  console.log(`PASS — all checks succeeded (${tablesBefore.length} tables, ${sampleBefore.length} rows sampled).`);
  fs.rmSync(SCRATCH_DIR, { recursive: true, force: true });
  console.log(`[info] Cleaned up temp copy at ${SCRATCH_DIR}`);
} else {
  console.log(`FAIL — ${problems.length} check(s) failed:`);
  for (const p of problems) console.log(`  - ${p}`);
  console.log(`[info] Working copy left in place for inspection: ${copyPath}`);
}

process.exit(exitCode);
