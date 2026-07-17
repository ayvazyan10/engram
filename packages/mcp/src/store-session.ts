#!/usr/bin/env node
/**
 * Standalone memory store — creates a NeuralBrain directly, stores one memory, and exits.
 * Used by session-end hooks when the REST server is not running.
 *
 * Usage:
 *   echo "session summary text" | node store-session.js
 *   node store-session.js "session summary text"
 */

import { NeuralBrain } from '@engram-ai-memory/core';

const source = process.env['ENGRAM_SOURCE'] || 'mcp-client';
const dbPath = process.env['ENGRAM_DB_PATH'];

async function main(): Promise<void> {
  let content: string;

  if (process.argv[2]) {
    content = process.argv.slice(2).join(' ');
  } else {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    content = Buffer.concat(chunks).toString('utf8').trim();
  }

  if (!content || content.length < 10) {
    process.exit(0);
  }

  const brain = new NeuralBrain({ dbPath, defaultSource: source });
  await brain.initialize();
  await brain.store({
    content,
    type: 'episodic',
    source,
    tags: ['session-summary', 'auto-stored'],
    importance: 0.6,
  });
  brain.shutdown();
}

main().catch(() => process.exit(0));
