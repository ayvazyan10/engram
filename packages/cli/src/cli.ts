#!/usr/bin/env node

/**
 * @engram/cli — Engram command-line interface.
 *
 * Usage:
 *   engram store "User prefers TypeScript" --type semantic --importance 0.8
 *   engram search "TypeScript" --top 5
 *   engram recall "what languages does the user prefer?"
 *   engram stats
 *   engram forget <id>
 *   engram export > backup.json
 *   engram import < backup.json
 */

import { Command } from 'commander';
import { NeuralBrain, closeDb } from '@engram/core';
import path from 'path';

const DEFAULT_DB_PATH = process.env['ENGRAM_DB_PATH'] ?? path.join(process.cwd(), 'engram.db');

function createBrain(): NeuralBrain {
  return new NeuralBrain({
    dbPath: DEFAULT_DB_PATH,
    defaultSource: 'cli',
    indexPath: process.env['ENGRAM_INDEX_PATH'] ?? DEFAULT_DB_PATH + '.index',
  });
}

async function withBrain<T>(fn: (brain: NeuralBrain) => Promise<T>): Promise<T> {
  const brain = createBrain();
  await brain.initialize();
  try {
    return await fn(brain);
  } finally {
    brain.shutdown();
  }
}

const program = new Command();

program
  .name('engram')
  .description('Engram CLI — store, search, recall, and manage AI memories')
  .version('0.1.0');

// ─── store ───────────────────────────────────────────────────────────────────

program
  .command('store <content>')
  .description('Store a new memory')
  .option('-t, --type <type>', 'Memory type: episodic, semantic, procedural', 'episodic')
  .option('-i, --importance <n>', 'Importance score 0.0–1.0', parseFloat)
  .option('-s, --source <source>', 'Source identifier', 'cli')
  .option('-c, --concept <concept>', 'Concept label (for semantic memories)')
  .option('--tags <tags>', 'Comma-separated tags')
  .option('-n, --namespace <ns>', 'Memory namespace')
  .action(async (content: string, opts) => {
    await withBrain(async (brain) => {
      const { memory, contradictions } = await brain.store({
        content,
        type: opts.type,
        importance: opts.importance,
        source: opts.source,
        concept: opts.concept,
        tags: opts.tags?.split(',').map((t: string) => t.trim()),
        namespace: opts.namespace,
      });

      console.log(`Stored: ${memory.id}`);
      console.log(`  type: ${memory.type}  importance: ${memory.importance}  model: ${memory.embeddingModel}`);

      if (contradictions.hasContradictions) {
        console.log(`\n  Contradictions detected: ${contradictions.contradictions.length}`);
        for (const c of contradictions.contradictions) {
          console.log(`    vs ${c.existingMemoryId.slice(0, 8)}... (confidence: ${c.confidence}, strategy: ${c.suggestedStrategy})`);
        }
      }
    });
  });

// ─── search ──────────────────────────────────────────────────────────────────

program
  .command('search <query>')
  .description('Semantic vector search across memories')
  .option('-k, --top <n>', 'Number of results', parseInt, 10)
  .option('--threshold <n>', 'Minimum similarity 0.0–1.0', parseFloat, 0.3)
  .option('-t, --type <type>', 'Filter by memory type')
  .option('--json', 'Output as JSON')
  .action(async (query: string, opts) => {
    await withBrain(async (brain) => {
      const types = opts.type ? [opts.type] : undefined;
      const results = await brain.search(query, {
        topK: opts.top,
        threshold: opts.threshold,
        types,
      });

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      if (results.length === 0) {
        console.log('No results found.');
        return;
      }

      console.log(`Found ${results.length} result(s):\n`);
      for (const m of results) {
        const preview = m.content.slice(0, 120).replace(/\n/g, ' ');
        console.log(`  ${m.id.slice(0, 8)}  [${m.type}]  imp=${m.importance.toFixed(2)}  ${m.source ?? ''}`);
        console.log(`    ${preview}${m.content.length > 120 ? '...' : ''}`);
        console.log();
      }
    });
  });

// ─── recall ──────────────────────────────────────────────────────────────────

program
  .command('recall <query>')
  .description('Assemble working memory context for a query')
  .option('-m, --max-tokens <n>', 'Maximum context tokens', parseInt, 2000)
  .option('-t, --type <type>', 'Filter by memory type')
  .option('--json', 'Output as JSON')
  .option('--raw', 'Output raw context string only (for piping)')
  .action(async (query: string, opts) => {
    await withBrain(async (brain) => {
      const types = opts.type ? [opts.type] : undefined;
      const result = await brain.recall(query, {
        maxTokens: opts.maxTokens,
        types,
        source: 'cli',
      });

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (opts.raw) {
        console.log(result.context);
        return;
      }

      console.log(`Recalled ${result.memories.length} memories (${result.latencyMs}ms)\n`);
      for (const m of result.memories) {
        console.log(`  ${m.id.slice(0, 8)}  [${m.type}]  score=${m.score.toFixed(3)}  sim=${m.similarity.toFixed(3)}`);
      }
      console.log(`\n--- Context (${result.context.length} chars) ---\n`);
      console.log(result.context);
    });
  });

// ─── stats ───────────────────────────────────────────────────────────────────

program
  .command('stats')
  .description('Show memory store statistics')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    await withBrain(async (brain) => {
      const stats = await brain.stats();
      const embStatus = await brain.embeddingStatus();
      const idxStatus = brain.getIndexStatus();

      if (opts.json) {
        console.log(JSON.stringify({ ...stats, embedding: embStatus, index: idxStatus }, null, 2));
        return;
      }

      console.log('Engram Brain Statistics');
      console.log('='.repeat(40));
      console.log(`  Total memories:  ${stats.total}`);
      console.log(`  Episodic:        ${stats.byType.episodic}`);
      console.log(`  Semantic:        ${stats.byType.semantic}`);
      console.log(`  Procedural:      ${stats.byType.procedural}`);
      console.log(`  Graph nodes:     ${stats.graphNodes}`);
      console.log(`  Graph edges:     ${stats.graphEdges}`);
      console.log(`  Index entries:   ${stats.indexSize}`);
      if (stats.namespace) console.log(`  Namespace:       ${stats.namespace}`);

      console.log();
      console.log('Sources:');
      for (const [src, count] of Object.entries(stats.bySource)) {
        console.log(`  ${src}: ${count}`);
      }

      console.log();
      console.log('Embedding:');
      console.log(`  Model:    ${embStatus.currentModel}`);
      console.log(`  Dim:      ${embStatus.currentDimension}`);
      console.log(`  Current:  ${embStatus.currentModelCount}  Stale: ${embStatus.staleCount}  Legacy: ${embStatus.legacyCount}`);

      console.log();
      console.log('Index:');
      console.log(`  Loaded from: ${idxStatus.loadedFrom}`);
      console.log(`  Init time:   ${idxStatus.initDurationMs}ms`);
      if (idxStatus.indexPath) console.log(`  Path:        ${idxStatus.indexPath}`);
    });
  });

// ─── forget ──────────────────────────────────────────────────────────────────

program
  .command('forget <id>')
  .description('Archive (soft-delete) a memory by ID')
  .action(async (id: string) => {
    await withBrain(async (brain) => {
      await brain.forget(id);
      console.log(`Archived: ${id}`);
    });
  });

// ─── export ──────────────────────────────────────────────────────────────────

program
  .command('export')
  .description('Export all memories as JSON (pipe to file: engram export > backup.json)')
  .option('-f, --format <fmt>', 'Output format: json or ndjson', 'json')
  .option('-t, --type <type>', 'Filter by memory type')
  .action(async (opts) => {
    await withBrain(async (brain) => {
      // Use search with very low threshold to get all memories
      // Export searches all types or a specific type
      const types = opts.type ? [opts.type] : undefined;
      const allMemories = await brain.search('', { topK: 100000, threshold: 0, types });

      if (opts.format === 'ndjson') {
        for (const m of allMemories) {
          console.log(JSON.stringify({ type: 'memory', data: stripBlobs(m as unknown as Record<string, unknown>) }));
        }
      } else {
        console.log(JSON.stringify({
          version: '0.1.0',
          exportedAt: new Date().toISOString(),
          count: allMemories.length,
          memories: allMemories.map((m) => stripBlobs(m as unknown as Record<string, unknown>)),
        }, null, 2));
      }
    });
  });

// ─── import ──────────────────────────────────────────────────────────────────

program
  .command('import')
  .description('Import memories from JSON (pipe from file: engram import < backup.json)')
  .option('--dry-run', 'Preview what would be imported without writing')
  .action(async (opts) => {
    // Read from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    const input = Buffer.concat(chunks).toString('utf8').trim();

    if (!input) {
      console.error('No input. Pipe a JSON file: engram import < backup.json');
      process.exit(1);
    }

    await withBrain(async (brain) => {
      let memories: Array<Record<string, unknown>> = [];

      // Detect NDJSON vs JSON
      if (input.startsWith('{') && input.includes('\n{')) {
        // NDJSON
        for (const line of input.split('\n')) {
          if (!line.trim()) continue;
          const entry = JSON.parse(line);
          if (entry.type === 'memory') memories.push(entry.data);
        }
      } else {
        const data = JSON.parse(input);
        memories = data.memories ?? [];
      }

      console.log(`Found ${memories.length} memories to import`);

      if (opts.dryRun) {
        console.log('Dry run — no changes made.');
        return;
      }

      let imported = 0;
      let skipped = 0;

      for (const m of memories) {
        try {
          await brain.store({
            content: m.content as string,
            type: (m.type as 'episodic' | 'semantic' | 'procedural') ?? 'episodic',
            source: (m.source as string) ?? 'import',
            importance: m.importance as number | undefined,
            concept: m.concept as string | undefined,
            tags: typeof m.tags === 'string' ? JSON.parse(m.tags as string) : m.tags as string[] | undefined,
            namespace: m.namespace as string | undefined,
          });
          imported++;
        } catch {
          skipped++;
        }
      }

      console.log(`Imported: ${imported}  Skipped: ${skipped}`);
    });
  });

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Strip binary blob fields for JSON export. */
function stripBlobs(m: Record<string, unknown>): Record<string, unknown> {
  const { embedding, ...rest } = m;
  return rest;
}

// ─── Run ─────────────────────────────────────────────────────────────────────

program.parseAsync().catch((err: unknown) => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
