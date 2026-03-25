# @engram-ai-memory/core

The Brain — memory engine, embeddings, knowledge graph, and retrieval for [Engram](https://github.com/ayvazyan10/engram).

## Install

```bash
npm install @engram-ai-memory/core
```

## Quick Start

```typescript
import { NeuralBrain } from '@engram-ai-memory/core';

const brain = new NeuralBrain({
  dbPath: './engram.db',
  defaultSource: 'my-app',
});

await brain.initialize();

// Store a memory
const { memory } = await brain.store({
  content: 'User prefers TypeScript',
  type: 'semantic',
  importance: 0.8,
});

// Recall context
const result = await brain.recall('What language does the user prefer?');
console.log(result.context);

// Search
const results = await brain.search('TypeScript');

// Stats
const stats = await brain.stats();

brain.shutdown();
```

## Features

- **3 Memory Types** — Episodic (events), Semantic (facts + knowledge graph), Procedural (patterns)
- **7-Step Recall** — Embed, vector search, graph expand, score, rank, truncate, log
- **Memory Decay** — Ebbinghaus forgetting curve with auto-consolidation
- **Namespace Isolation** — Scoped memory workspaces per project/agent
- **Contradiction Detection** — Auto-detect conflicting memories with resolution strategies
- **Embedding Upgradability** — Swap models, re-embed pipeline, model tracking
- **Streaming Recall** — Progressive context assembly via async generator
- **Index Persistence** — Save/load vector index for fast startup (27x speedup)
- **Webhooks** — Subscribe to memory events (stored, forgotten, decayed, consolidated, contradiction)
- **Tags & Collections** — Tag cloud, filter by tag, prefix-based collections
- **Plugin System** — 6 lifecycle hooks (onStore, onRecall, onForget, onDecay, onStartup, onShutdown)
- **PostgreSQL Support** — Optional, via `ENGRAM_DATABASE=postgresql`

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ENGRAM_DB_PATH` | `./engram.db` | SQLite database path |
| `ENGRAM_DATABASE` | `sqlite` | `sqlite` or `postgresql` |
| `DATABASE_URL` | — | PostgreSQL connection URL |
| `ENGRAM_NAMESPACE` | — | Memory namespace isolation |
| `ENGRAM_INDEX_PATH` | `{dbPath}.index` | Persistent vector index path |
| `ENGRAM_EMBEDDING_MODEL` | `Xenova/all-MiniLM-L6-v2` | Embedding model |

## Embedding

Uses `Xenova/all-MiniLM-L6-v2` (384-dim) via ONNX/WASM — runs locally, no API calls, no cost. FP16 compressed for 2x storage savings.

## Links

- [GitHub](https://github.com/ayvazyan10/engram)
- [Documentation](https://github.com/ayvazyan10/engram/tree/master/docs)
- [Website](https://engram.am)

## License

MIT
