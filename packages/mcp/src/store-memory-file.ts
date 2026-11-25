#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { readContent, storeLocalMemory } from './store-session.js';

async function main(): Promise<void> {
  const file = await readContent(process.argv, process.stdin);
  if (!file || !path.isAbsolute(file)) return;
  const normalized = path.normalize(file).split(path.sep).join('/');
  const match = normalized.match(/\/\.claude\/projects\/([^/]+\/memory\/([^/]*\.md))$/);
  if (!match || match[2] === 'MEMORY.md' || !(await fs.lstat(file)).isFile()) return;
  const content = await fs.readFile(file, 'utf8');
  if (!content) return;

  await storeLocalMemory({
    content, type: 'semantic', source: 'claude-code',
    tags: ['memory-file', 'memory-file:' + match[2]],
    metadata: { claudeMemoryFile: match[1] },
  }, process.env);
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error('[engram-store-memory-file] Could not mirror memory file:', err);
  });
}
