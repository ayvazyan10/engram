import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { closeDatabase, getDatabase } from './adapter.ts';

let directory = '';
afterEach(() => {
  closeDatabase();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

function migration(name: string): string {
  return readFileSync(new URL(`./migrations/${name}.sql`, import.meta.url), 'utf8');
}

function hits(db: Database.Database, query: string): unknown[] {
  return db.prepare('SELECT rowid FROM memories_fts WHERE memories_fts MATCH ?').all(query);
}

it.each(['runtime', 'tooling'])('%s migration backfills old rows and keeps external writes synchronized', (mode) => {
  directory = mkdtempSync(join(tmpdir(), 'engram-fts-upgrade-'));
  const path = join(directory, 'old.db');
  const db = new Database(path);
  try {
    db.exec(migration('0000_cynical_marauders'));
    db.exec(migration('0001_same_wither'));
    db.prepare('INSERT INTO memories(id, type, content, concept, tags) VALUES (?, ?, ?, ?, ?)')
      .run('old', 'semantic', 'legacyword', 'legacyconcept', '["legacytag"]');
    if (mode === 'runtime') {
      getDatabase(path);
      closeDatabase();
      getDatabase(path); // Idempotent reopen must not duplicate the index.
    } else db.exec(migration('0002_memory_fts'));
    for (const word of ['legacyword', 'legacyconcept', 'legacytag']) expect(hits(db, word)).toHaveLength(1);
    db.prepare('UPDATE memories SET content = ?, concept = ?, tags = ? WHERE id = ?')
      .run('replacement', 'newconcept', '["newtag"]', 'old');
    for (const word of ['legacyword', 'legacyconcept', 'legacytag']) expect(hits(db, word)).toHaveLength(0);
    for (const word of ['replacement', 'newconcept', 'newtag']) expect(hits(db, word)).toHaveLength(1);
    db.prepare('UPDATE memories SET embedding = ?, archived_at = ? WHERE id = ?')
      .run(Buffer.alloc(768), '2026-01-01', 'old');
    // External-content tables index all rows; retrieval filters archived_at.
    db.exec("INSERT INTO memories_fts(memories_fts, rank) VALUES ('integrity-check', 1)");
    db.prepare('DELETE FROM memories WHERE id = ?').run('old');
    expect(hits(db, 'replacement')).toEqual([]);
    db.exec("INSERT INTO memories_fts(memories_fts, rank) VALUES ('integrity-check', 1)");
  } finally {
    db.close();
  }
});
