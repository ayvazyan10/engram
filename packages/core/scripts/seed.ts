/**
 * Seed script — populates the database with sample memories for testing.
 * Run: cd packages/core && npx tsx scripts/seed.ts
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { NeuralBrain } from '../src/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'neuralcore.db');

async function seed() {
  console.info('Seeding NeuralCore database...');
  console.info(`DB path: ${dbPath}`);

  const brain = new NeuralBrain({ dbPath, defaultSource: 'seed-script' });
  await brain.initialize();

  // ── Semantic memories (facts/knowledge) ──
  console.info('Storing semantic memories...');

  await brain.store({
    type: 'semantic',
    concept: 'TypeScript',
    content: 'TypeScript is a strongly typed programming language that builds on JavaScript. It adds optional static typing and class-based object-oriented programming to the language.',
    tags: ['programming', 'language', 'javascript'],
    importance: 0.8,
  });

  await brain.store({
    type: 'semantic',
    concept: 'NeuralCore',
    content: 'NeuralCore is a universal AI brain — a persistent memory and cognition layer that gives any AI model human-like memory across sessions, systems, and restarts.',
    tags: ['project', 'ai', 'memory'],
    importance: 0.9,
  });

  await brain.store({
    type: 'semantic',
    concept: 'MCP Protocol',
    content: 'Model Context Protocol (MCP) is an open standard that enables AI models to securely connect with local and remote resources through tool definitions.',
    tags: ['protocol', 'ai', 'integration'],
    importance: 0.8,
  });

  // ── Procedural memories (patterns/skills) ──
  console.info('Storing procedural memories...');

  await brain.store({
    type: 'procedural',
    triggerPattern: 'User asks about database migrations',
    actionPattern: 'Use drizzle-kit generate then drizzle-kit migrate. Never use drizzle-kit push on live data.',
    content: 'For Drizzle ORM: always use drizzle-kit generate → drizzle-kit migrate workflow. Never drizzle-kit push on production data as it can cause data loss.',
    tags: ['database', 'drizzle', 'migrations'],
    confidence: 1.0,
  });

  await brain.store({
    type: 'procedural',
    triggerPattern: 'Need to search for similar content',
    actionPattern: 'Use vector embedding similarity search via recall_context MCP tool',
    content: 'For semantic search: embed the query, run cosine similarity against the vector index, expand via graph traversal, score by importance + recency.',
    tags: ['search', 'vectors', 'embeddings'],
    confidence: 0.9,
  });

  // ── Episodic memories (events/conversations) ──
  console.info('Storing episodic memories...');

  await brain.store({
    type: 'episodic',
    content: 'User clarified that NeuralCore should be a universal AI brain that integrates with Claude Code, Ollama, OpenClaw, and other AI systems via MCP and REST API.',
    source: 'claude-code',
    tags: ['requirements', 'vision'],
    importance: 0.9,
  });

  await brain.store({
    type: 'episodic',
    content: 'Decision made to use pnpm monorepo with Turborepo, Fastify backend, React + Three.js frontend, Drizzle ORM with SQLite for dev and PostgreSQL for prod.',
    source: 'claude-code',
    tags: ['architecture', 'decisions'],
    importance: 0.8,
  });

  const stats = await brain.stats();
  console.info('\n✓ Seeding complete!');
  console.info(`  Total memories: ${stats.total}`);
  console.info(`  Episodic: ${stats.byType.episodic}`);
  console.info(`  Semantic: ${stats.byType.semantic}`);
  console.info(`  Procedural: ${stats.byType.procedural}`);

  // Test recall
  console.info('\nTesting recall...');
  const result = await brain.recall('what is the database migration workflow?');
  console.info(`Recall latency: ${result.latencyMs}ms`);
  console.info(`Memories used: ${result.memories.length}`);
  if (result.context) {
    console.info('\nContext preview (first 300 chars):');
    console.info(result.context.slice(0, 300));
  }

  brain.shutdown();
}

seed().catch((err: unknown) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
