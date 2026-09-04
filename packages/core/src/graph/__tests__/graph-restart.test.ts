/**
 * Regression tests for edge bookkeeping across a restart.
 *
 * Nothing cleared the graph, initialize() re-added every node and edge, and
 * addEdge appended without deduplicating — so a shutdown()/initialize() cycle
 * in one process doubled every edge, and a reconcile double-added an edge whose
 * two endpoints landed in different id chunks. Traversal results were unaffected
 * (expand() keeps a visited set) but stats().graphEdges and the cost of every
 * traversal grew with each cycle, without bound.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

import { NeuralBrain } from '../../NeuralBrain.js';
import { closeDb } from '../../db/index.js';
import { cleanupTestDb } from '../../test-helpers/cleanupTestDb.js';
import { KnowledgeGraph } from '../KnowledgeGraph.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '../../db/migrations');

/**
 * The migration is resolved from the directory, not by filename: drizzle
 * renames the generated file every time it is regenerated, and a hard-coded
 * name turns that rename into an ENOENT in every suite at once.
 */
const MIGRATION_SQL = fs.readFileSync(
  path.join(
    MIGRATIONS_DIR,
    fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()[0]!,
  ),
  'utf-8',
);

/** Apply the schema, tolerating either migration generation. */
function applySchema(sqlite: InstanceType<typeof Database>): void {
  for (const stmt of MIGRATION_SQL.split('--> statement-breakpoint')) {
    const sql = stmt.trim();
    if (sql) sqlite.exec(sql);
  }
  // `memories.namespace` arrived in a later migration generation; add it only
  // when the schema just applied does not already carry it.
  const { n } = sqlite
    .prepare("SELECT COUNT(*) AS n FROM pragma_table_info('memories') WHERE name = 'namespace'")
    .get() as { n: number };
  if (n === 0) {
    sqlite.exec('ALTER TABLE memories ADD COLUMN namespace text');
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_memories_namespace ON memories (namespace)');
  }
}

function createTestDb(): string {
  const dbPath = path.join(
    __dirname,
    `test-graph-restart-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
  const sqlite = new Database(dbPath);
  applySchema(sqlite);
  sqlite.close();
  return dbPath;
}

describe('KnowledgeGraph.addEdge', () => {
  it('is idempotent for the same (source, target, relationship)', () => {
    const graph = new KnowledgeGraph();
    graph.addNode({ id: 'a', type: 'semantic' });
    graph.addNode({ id: 'b', type: 'semantic' });

    graph.addEdge({ sourceId: 'a', targetId: 'b', relationship: 'relates_to', strength: 0.5, bidirectional: true });
    // One connection. The mirrored pair of adjacency entries is what makes it
    // traversable from either end, and the adjacency lists are what prove the
    // mirror exists — edgeCount reports connections, not directions.
    expect(graph.edgeCount).toBe(1);
    expect(graph.getNeighbors('a')).toHaveLength(1);
    expect(graph.getNeighbors('b')).toHaveLength(1);

    graph.addEdge({ sourceId: 'a', targetId: 'b', relationship: 'relates_to', strength: 0.9, bidirectional: true });
    expect(graph.edgeCount).toBe(1);
    // Replaced in place, in BOTH directions — an appended duplicate would show
    // up here even though the folded count could not see it.
    expect(graph.getNeighbors('a')).toHaveLength(1);
    expect(graph.getNeighbors('b')).toHaveLength(1);
    // The later edge wins, rather than shadowing the first forever.
    expect(graph.getNeighbors('a')[0]!.strength).toBe(0.9);

    // A different relationship between the same pair is a different edge.
    graph.addEdge({ sourceId: 'a', targetId: 'b', relationship: 'contradicts', strength: 0.4, bidirectional: true });
    expect(graph.edgeCount).toBe(2);
    expect(graph.getNeighbors('a')).toHaveLength(2);
    expect(graph.getNeighbors('b')).toHaveLength(2);
  });
});

describe('NeuralBrain restart', () => {
  let dbPath: string;
  let brain: NeuralBrain;

  beforeEach(() => {
    dbPath = createTestDb();
  });

  afterEach(async () => {
    brain?.shutdown();
    await closeDb();
    cleanupTestDb(dbPath);
  });

  it('does not double the graph on shutdown() then initialize()', async () => {
    brain = new NeuralBrain({ dbPath, defaultSource: 'test' });
    await brain.initialize();
    await brain.store({ content: 'Alpha beta gamma delta epsilon', type: 'semantic' });
    await brain.store({ content: 'Alpha beta gamma delta zeta', type: 'semantic' });

    const before = await brain.stats();
    expect(before.graphEdges).toBeGreaterThan(0);

    brain.shutdown();
    await brain.initialize();
    const afterOne = await brain.stats();

    brain.shutdown();
    await brain.initialize();
    const afterTwo = await brain.stats();

    expect(afterOne.graphEdges).toBe(before.graphEdges);
    expect(afterTwo.graphEdges).toBe(before.graphEdges);
    expect(afterTwo.graphNodes).toBe(before.graphNodes);
  });
});
