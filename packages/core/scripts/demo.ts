/**
 * Demo seed — rich set of interconnected neurons for visualization.
 * Run: cd packages/core && npx tsx scripts/demo.ts
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { NeuralBrain } from '../src/index.js';
import { getDb } from '../src/db/index.js';
import { memoryConnections } from '../src/db/schema.js';
import { randomUUID } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.join(__dirname, '..', 'engram.db');

const brain = new NeuralBrain({ dbPath, defaultSource: 'demo' });

async function store(input: Parameters<typeof brain.store>[0]) {
  const { memory } = await brain.store(input);
  return memory;
}

async function connect(sourceId: string, targetId: string, relationship: string, strength = 0.8) {
  await getDb().insert(memoryConnections).values({
    id: randomUUID(),
    sourceId,
    targetId,
    relationship,
    strength,
    bidirectional: 0,
  }).onConflictDoNothing();
}

async function run() {
  console.info('Loading demo neurons into Engram...');
  await brain.initialize();

  // ── SEMANTIC — AI & ML concepts ──
  const neuralNetworks = await store({
    type: 'semantic', concept: 'Neural Networks',
    content: 'Neural networks are computing systems inspired by biological neural networks. Composed of layers of interconnected nodes that process information using connectionist approaches.',
    importance: 0.95, tags: ['ai', 'ml', 'deep-learning'],
  });

  const transformers = await store({
    type: 'semantic', concept: 'Transformers',
    content: 'Transformer architecture uses self-attention mechanisms to process sequential data. Foundation of modern LLMs like GPT, Claude, and Gemini. Introduced in "Attention Is All You Need" (2017).',
    importance: 0.9, tags: ['ai', 'architecture', 'llm'],
  });

  const embeddings = await store({
    type: 'semantic', concept: 'Vector Embeddings',
    content: 'Dense numerical representations of text/data in high-dimensional space. Semantically similar content clusters together. Enable semantic search and retrieval-augmented generation.',
    importance: 0.88, tags: ['ai', 'vectors', 'search'],
  });

  const rag = await store({
    type: 'semantic', concept: 'RAG',
    content: 'Retrieval-Augmented Generation: combines vector search with LLM generation. Grounds model outputs in factual retrieved context, reducing hallucinations.',
    importance: 0.85, tags: ['ai', 'retrieval', 'llm'],
  });

  const mcp = await store({
    type: 'semantic', concept: 'MCP Protocol',
    content: 'Model Context Protocol: open standard for AI tool integration. Enables Claude Code and other MCP-compatible clients to call tools like store_memory and recall_context.',
    importance: 0.9, tags: ['protocol', 'integration', 'claude'],
  });

  const attention = await store({
    type: 'semantic', concept: 'Attention Mechanism',
    content: 'Self-attention computes relationships between all tokens in a sequence simultaneously. Scaled dot-product attention: softmax(QK^T / √d_k)V. Core of transformer architecture.',
    importance: 0.82, tags: ['ai', 'architecture', 'math'],
  });

  const forgettingCurve = await store({
    type: 'semantic', concept: 'Ebbinghaus Forgetting Curve',
    content: 'Exponential decay model of memory retention. R = e^(-t/S) where t=time, S=stability. Engram uses this to decay importance over time, prioritizing recent and accessed memories.',
    importance: 0.78, tags: ['memory', 'psychology', 'algorithm'],
  });

  // ── SEMANTIC — Software architecture ──
  const neuralCore = await store({
    type: 'semantic', concept: 'Engram',
    content: 'Universal AI brain — persistent memory layer giving any AI model human-like memory. Integrates via MCP (Claude Code), REST API (Ollama, OpenClaw), with 3D visualization dashboard.',
    importance: 1.0, tags: ['project', 'ai', 'memory', 'brain'],
  });

  const monorepo = await store({
    type: 'semantic', concept: 'Monorepo Architecture',
    content: 'Single repository containing multiple packages: @engram/core (brain), @engram/mcp (Claude), @engram/server (REST API), @engram/web (dashboard). Managed by pnpm + Turborepo.',
    importance: 0.75, tags: ['architecture', 'pnpm', 'turborepo'],
  });

  const vectorSearch = await store({
    type: 'semantic', concept: 'HNSW Vector Index',
    content: 'Hierarchical Navigable Small World graph for approximate nearest neighbor search. O(log n) query time vs O(n) brute force. Engram uses HNSW-lite for in-memory vector indexing.',
    importance: 0.8, tags: ['algorithm', 'vectors', 'search'],
  });

  const drizzle = await store({
    type: 'semantic', concept: 'Drizzle ORM',
    content: 'Type-safe SQL ORM for TypeScript. Schema defined in code, migrations via drizzle-kit generate → migrate. Never use drizzle-kit push on production data.',
    importance: 0.72, tags: ['database', 'orm', 'typescript'],
  });

  const sqlite = await store({
    type: 'semantic', concept: 'SQLite WAL Mode',
    content: 'Write-Ahead Logging enables concurrent reads with writes. Dramatically improves write throughput. Engram achieves >10,000 memory writes/second in WAL mode.',
    importance: 0.7, tags: ['database', 'performance', 'sqlite'],
  });

  // ── SEMANTIC — Human memory model ──
  const episodicMem = await store({
    type: 'semantic', concept: 'Episodic Memory',
    content: 'Stores specific events and experiences with temporal context. "What happened when?" — conversations, decisions, interactions. Decays faster than semantic memory.',
    importance: 0.85, tags: ['memory', 'cognitive', 'brain'],
  });

  const semanticMem = await store({
    type: 'semantic', concept: 'Semantic Memory',
    content: 'General world knowledge, facts, and concepts without temporal context. "What is X?" — persists long-term. Foundation of intelligence and reasoning.',
    importance: 0.85, tags: ['memory', 'cognitive', 'brain'],
  });

  const proceduralMem = await store({
    type: 'semantic', concept: 'Procedural Memory',
    content: 'How to do things — patterns, skills, rules, and procedures. "How to do X?" — trigger-action pairs. Used for behavioral guidance and repeated task patterns.',
    importance: 0.82, tags: ['memory', 'cognitive', 'brain'],
  });

  const workingMem = await store({
    type: 'semantic', concept: 'Working Memory',
    content: 'Active context window — temporarily holds information being processed. Engram assembles working memory by combining relevant episodic + semantic + procedural memories for a query.',
    importance: 0.88, tags: ['memory', 'cognitive', 'context'],
  });

  // ── PROCEDURAL — Development patterns ──
  const migrationPattern = await store({
    type: 'procedural',
    triggerPattern: 'Schema change needed',
    actionPattern: 'drizzle-kit generate → review SQL → drizzle-kit migrate',
    content: 'Database migration workflow: edit schema.ts → run drizzle-kit generate → inspect generated SQL → run drizzle-kit migrate. NEVER use drizzle-kit push on live data.',
    importance: 0.9, tags: ['database', 'workflow', 'safety'],
  });

  const embeddingPattern = await store({
    type: 'procedural',
    triggerPattern: 'Need semantic similarity between texts',
    actionPattern: 'Embed with all-MiniLM-L6-v2 → cosine similarity → HNSW search',
    content: 'Semantic similarity pipeline: input text → @xenova/transformers (WASM, local, no API) → 384-dim float32 embedding → pack to FP16 → store in DB + HNSW index → cosine similarity search.',
    importance: 0.85, tags: ['embeddings', 'pipeline', 'vectors'],
  });

  const recallPattern = await store({
    type: 'procedural',
    triggerPattern: 'AI model needs memory context for a query',
    actionPattern: 'embed query → vector search → graph expand → score → assemble context',
    content: 'Context recall: 1) embed query 2) vector search top-K 3) BFS graph expand depth-2 4) load from DB 5) score by similarity+recency+importance+access 6) truncate to maxTokens 7) log assembly.',
    importance: 0.95, tags: ['recall', 'context', 'pipeline'],
  });

  const debugPattern = await store({
    type: 'procedural',
    triggerPattern: 'Port already in use error',
    actionPattern: 'fuser -k PORT/tcp then restart',
    content: 'When EADDRINUSE: run fuser -k 4901/tcp to kill existing process, then restart the server. Check with ss -tlnp to confirm port is free.',
    importance: 0.65, tags: ['debugging', 'devops'],
  });

  const buildPattern = await store({
    type: 'procedural',
    triggerPattern: 'Build packages in monorepo',
    actionPattern: 'pnpm turbo run build — respects dependency order automatically',
    content: 'Turborepo build: pnpm turbo run build. Pipeline defined in turbo.json with dependsOn: ["^build"]. Core must build before MCP/server. Cache invalidation is automatic.',
    importance: 0.7, tags: ['build', 'monorepo', 'turborepo'],
  });

  const ollamaIntegration = await store({
    type: 'procedural',
    triggerPattern: 'Ollama chat request received on port 11435',
    actionPattern: 'intercept → recall context → inject into system prompt → proxy to 11434 → store exchange',
    content: 'Ollama memory proxy: intercepts OpenAI-compatible chat on localhost:11435, calls /api/recall with user message, prepends context to system prompt, forwards to real Ollama on 11434, stores response as episodic memory.',
    importance: 0.8, tags: ['ollama', 'proxy', 'integration'],
  });

  // ── EPISODIC — Project history ──
  const visionDecision = await store({
    type: 'episodic',
    content: 'User confirmed the vision: Engram must be a universal AI brain, open source, integrating with Claude Code (MCP), Ollama, OpenClaw, and any future AI systems. Not just a visualization tool.',
    source: 'claude-code', importance: 0.95,
    tags: ['vision', 'decision', 'requirements'],
  });

  const techStackDecision = await store({
    type: 'episodic',
    content: 'Architecture decisions locked: pnpm monorepo, Turborepo, Fastify 5 + Socket.io, Drizzle ORM + SQLite (dev) + pgvector (prod), @xenova/transformers for local embeddings, React Three Fiber for 3D viz.',
    source: 'claude-code', importance: 0.9,
    tags: ['architecture', 'decisions', 'tech-stack'],
  });

  const exactOptionalFix = await store({
    type: 'episodic',
    content: 'Fixed TypeScript error: exactOptionalPropertyTypes: true caused assignment failures with optional properties typed as T | undefined. Changed to false in tooling/tsconfig/base.json.',
    source: 'claude-code', importance: 0.7,
    tags: ['typescript', 'bug-fix', 'build'],
  });

  const socketFix = await store({
    type: 'episodic',
    content: 'Fixed Socket.io initialization bug: new SocketIOServer({ namespace: "/neural" }) is invalid. Correct pattern is io.of("/neural") to create a named namespace after server creation.',
    source: 'claude-code', importance: 0.75,
    tags: ['socket.io', 'bug-fix', 'websocket'],
  });

  const seedVerified = await store({
    type: 'episodic',
    content: 'Verified NeuralBrain core works: seed script stored 7 memories and tested recall at 14ms latency — well within the <100ms p99 target. HNSW index and graph traversal both functional.',
    source: 'claude-code', importance: 0.8,
    tags: ['verification', 'performance', 'milestone'],
  });

  const mcpToolsBuilt = await store({
    type: 'episodic',
    content: 'MCP server completed with 6 tools: store_memory, search_memory, recall_context, add_knowledge, memory_stats, forget. Uses @modelcontextprotocol/sdk StdioServerTransport for Claude Code integration.',
    source: 'claude-code', importance: 0.85,
    tags: ['mcp', 'milestone', 'claude-code'],
  });

  const dashboardBuilt = await store({
    type: 'episodic',
    content: 'React 3D visualization dashboard completed: NeuralCanvas (R3F + OrbitControls), NeuronMesh (activation glow animations), ConnectionLine (dashed for weak links), MemoryPanel, SearchBar, NeuronInspector, StatusBar.',
    source: 'claude-code', importance: 0.88,
    tags: ['dashboard', 'milestone', 'visualization'],
  });

  const phase9Complete = await store({
    type: 'episodic',
    content: 'Phase 9 complete: full monorepo builds (7/7 packages). Engram now has core brain, MCP server, REST API, Ollama proxy, OpenClaw adapter, and React dashboard. All TypeScript errors resolved.',
    source: 'claude-code', importance: 0.92,
    tags: ['milestone', 'build', 'complete'],
  });

  // ── Connect neurons ──
  console.info('Creating knowledge connections...');

  // Core AI concepts
  await connect(transformers.id, attention.id, 'uses', 0.95);
  await connect(transformers.id, embeddings.id, 'produces', 0.9);
  await connect(transformers.id, neuralNetworks.id, 'is_a', 0.85);
  await connect(rag.id, embeddings.id, 'depends_on', 0.92);
  await connect(rag.id, vectorSearch.id, 'uses', 0.88);
  await connect(mcp.id, neuralCore.id, 'integrates_with', 0.95);

  // Memory model
  await connect(neuralCore.id, episodicMem.id, 'implements', 0.9);
  await connect(neuralCore.id, semanticMem.id, 'implements', 0.9);
  await connect(neuralCore.id, proceduralMem.id, 'implements', 0.9);
  await connect(neuralCore.id, workingMem.id, 'implements', 0.88);
  await connect(workingMem.id, episodicMem.id, 'assembles_from', 0.85);
  await connect(workingMem.id, semanticMem.id, 'assembles_from', 0.85);
  await connect(workingMem.id, proceduralMem.id, 'assembles_from', 0.82);
  await connect(forgettingCurve.id, episodicMem.id, 'models_decay_of', 0.8);

  // Architecture
  await connect(neuralCore.id, monorepo.id, 'structured_as', 0.8);
  await connect(neuralCore.id, vectorSearch.id, 'uses', 0.88);
  await connect(neuralCore.id, drizzle.id, 'uses', 0.75);
  await connect(drizzle.id, sqlite.id, 'runs_on', 0.85);
  await connect(vectorSearch.id, embeddings.id, 'indexes', 0.9);
  await connect(rag.id, neuralCore.id, 'pattern_implemented_by', 0.85);

  // Procedural → semantic links
  await connect(embeddingPattern.id, embeddings.id, 'implements', 0.9);
  await connect(recallPattern.id, workingMem.id, 'assembles', 0.92);
  await connect(recallPattern.id, vectorSearch.id, 'uses', 0.88);
  await connect(migrationPattern.id, drizzle.id, 'governs', 0.9);
  await connect(ollamaIntegration.id, recallPattern.id, 'uses', 0.85);

  // Episodic → semantic links
  await connect(visionDecision.id, neuralCore.id, 'defines', 0.95);
  await connect(techStackDecision.id, monorepo.id, 'chose', 0.85);
  await connect(techStackDecision.id, drizzle.id, 'chose', 0.8);
  await connect(seedVerified.id, recallPattern.id, 'verified', 0.8);
  await connect(mcpToolsBuilt.id, mcp.id, 'implements', 0.9);
  await connect(dashboardBuilt.id, neuralCore.id, 'extends', 0.85);
  await connect(exactOptionalFix.id, techStackDecision.id, 'relates_to', 0.6);
  await connect(phase9Complete.id, dashboardBuilt.id, 'follows', 0.9);
  await connect(phase9Complete.id, mcpToolsBuilt.id, 'follows', 0.88);

  const stats = await brain.stats();
  console.info('\n✓ Demo neurons loaded!');
  console.info(`  Total: ${stats.total} memories`);
  console.info(`  Episodic:   ${stats.byType.episodic ?? 0}`);
  console.info(`  Semantic:   ${stats.byType.semantic ?? 0}`);
  console.info(`  Procedural: ${stats.byType.procedural ?? 0}`);

  brain.shutdown();
}

run().catch((err: unknown) => {
  console.error('Demo seed failed:', err);
  process.exit(1);
});
