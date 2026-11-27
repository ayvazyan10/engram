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
- **Hybrid Search** — Optionally combine vector similarity and SQLite FTS5/BM25. Search and recall can filter on dates and tags
- **Recall Preview** — `explainRecall` returns the ranked candidates, token budget and context without recording a recall
- **Memory Decay** — Ebbinghaus forgetting curve with auto-consolidation
- **Namespace Isolation** — Scoped memory workspaces per project/agent. Set `namespaceMode` and `namespace` on `NeuralBrain`. The default is `none`, or `filter` when only a namespace is supplied
- **Contradiction Detection** — Heuristics nominate possible conflicts for verification before resolution
- **Embedding Upgradability** — Swap models, re-embed pipeline, model tracking
- **Streaming Recall** — Progressive context assembly via async generator
- **Batch Storage & Deduplication** — `storeBatch` embeds a batch together. Compatible same-type memories can merge in the same namespace
- **Index Persistence** — Save/load vector index for fast startup (27x speedup)
- **Webhooks** — Subscribe to memory events (stored, forgotten, decayed, consolidated, contradiction, reflected)
- **Tags & Collections** — Tag cloud, filter by tag, prefix-based collections
- **Plugin System** — 7 lifecycle hooks (onStore, onRecall, onForget, onDecay, onReflect, onStartup, onShutdown)
- **Reflection** — Generate tasks for a connected AI and store its insights
- **Cloud Sync** — `SyncEngine` replicates through PostgreSQL with optional end-to-end encryption

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `ENGRAM_DB_PATH` | `~/.engram/engram.db` | SQLite database path (the only supported primary backend) |
| `ENGRAM_INDEX_PATH` | `{dbPath}.index` with an explicit `dbPath` | Index persistence is off if neither path is configured. Isolated mode appends a namespace hash |
| `ENGRAM_EMBEDDING_MODEL` | automatic | Existing databases retain their stored model unless overridden |
| `ENGRAM_HYBRID_SEARCH` | off | `1` or `true` enables hybrid retrieval unless `hybridSearch` is set in `BrainConfig` |
| `ENGRAM_DEDUP_THRESHOLD` | `0.97` | Minimum cosine similarity for a store-time merge (greater than 0, up to 1) |

## Embedding

New databases use `Xenova/paraphrase-multilingual-MiniLM-L12-v2` (384-dim, ~118 MB quantized, multilingual). ONNX inference runs locally after the weights download. FP16 halves vector storage compared with FP32.

## Links

- [GitHub](https://github.com/ayvazyan10/engram)
- [Documentation](https://github.com/ayvazyan10/engram/tree/master/docs)
- [Website](https://engram.am)

## License

MIT
