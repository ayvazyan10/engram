# Integrations

Engram exposes multiple integration surfaces:

1. **MCP Server** — for Claude Code and any MCP-compatible client (18 tools)
2. **REST API** — for everything else (Ollama, OpenClaw, custom apps, 40+ endpoints)
3. **CLI** — terminal workflows and scripting
4. **Webhooks** — push notifications to external systems on memory events
5. **Plugin System** — extend Engram with lifecycle hooks

---

## Claude Code (MCP)

The MCP server exposes Engram as native tools inside Claude Code. No API calls needed — Claude uses `store_memory`, `recall_context`, etc. directly as tool calls.

### Setup

**1. Build the MCP server**

```bash
cd /path/to/neuralcore
pnpm turbo run build --filter=@engram-ai-memory/mcp
```

**2. Add to Claude Code settings**

```json
// ~/.claude/settings.json
{
  "mcpServers": {
    "engram": {
      "command": "node",
      "args": ["/path/to/neuralcore/packages/mcp/dist/server.js"],
      "env": {
        "ENGRAM_DB_PATH": "/path/to/neuralcore/packages/core/engram.db"
      }
    }
  }
}
```

**3. Restart Claude Code** — the tools will appear automatically.

### Auto-store conversations (optional)

By default, memories are only stored when Claude explicitly calls `store_memory`. To automatically save a conversation summary to engram when each session ends, add a Claude Code hook:

```bash
# Copy the hook script from the repo
cp scripts/claude-code-hook.sh ~/.claude/hooks/engram-session-end.sh
chmod +x ~/.claude/hooks/engram-session-end.sh
```

Add to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "SessionEnd": [{
      "matcher": "",
      "hooks": [{
        "type": "command",
        "command": "~/.claude/hooks/engram-session-end.sh",
        "timeout": 15
      }]
    }]
  }
}
```

The hook reads the session transcript, extracts assistant messages, and stores them as an episodic memory tagged `auto-stored`. The brain grows automatically with every conversation.

### Available MCP tools

#### `store_memory`

Store any information as a persistent memory.

```
Input:
  content     string   required  — text to store
  type        string   optional  — 'episodic' | 'semantic' | 'procedural' (default: episodic)
  source      string   optional  — defaults to 'claude-code'
  tags        string[] optional  — categorization
  importance  float    optional  — 0.0–1.0
  concept     string   optional  — for semantic memories: concept label
  sessionId   string   optional  — group related episodic memories

Output:
  { id, type, importance, message }
```

**Example usage in Claude Code:**
> "Remember that the user's name is Alex and they prefer concise answers."
> → Claude calls `store_memory` with `type: "semantic"`, `concept: "user preferences"`

---

#### `recall_context`

Assemble relevant memories for a query. **This is the primary tool** — use it at the start of any task to load relevant context.

```
Input:
  query      string   required  — what you want to remember about
  maxTokens  integer  optional  — token budget (default: 2000)
  sources    string[] optional  — restrict to specific sources
  sessionId  string   optional  — include session-specific memories

Output:
  { context, memories, latencyMs }
  context — formatted string, ready to use as context
```

**Example usage:**
> At the start of a coding session, Claude calls `recall_context` with the project description to load all relevant architectural decisions, preferences, and past work.

---

#### `search_memory`

Search for specific memories by semantic similarity.

```
Input:
  query      string   required
  topK       integer  optional  — number of results (default: 10)
  threshold  float    optional  — minimum similarity (default: 0.3)
  types      string[] optional  — filter by memory type

Output:
  { results: Memory[], count }
```

---

#### `add_knowledge`

Shortcut for storing semantic facts/knowledge with a concept label.

```
Input:
  concept  string   required  — concept name
  content  string   required  — knowledge about the concept
  tags     string[] optional
  importance float  optional

Output:
  { id, concept, importance }
```

---

#### `memory_stats`

Get statistics about the current brain state.

```
Output:
  { total, byType, bySource, indexSize, graphNodes, graphEdges }
```

---

#### `forget`

Archive one or more memories (soft delete).

```
Input:
  ids     string[]  required  — memory IDs to archive
  reason  string    optional  — reason for archiving

Output:
  { archived: number }
```

---

#### `decay_sweep`

Run a memory decay sweep — evaluate all memories and archive stale ones.

```
Input:
  dryRun  boolean  optional  — preview without modifying (default: false)

Output:
  { scannedCount, archivedCount, decayedCount, protectedCount, consolidatedCount, durationMs }
```

---

#### `decay_policy`

View or update the memory decay policy configuration.

```
Input:
  action               "get"|"update"  required
  halfLifeDays         number          optional — Ebbinghaus half-life in days
  archiveThreshold     number          optional — retention score floor (0–1)
  importanceDecayRate  number          optional — daily importance reduction
  importanceFloor      number          optional — minimum importance
  consolidationEnabled boolean         optional — enable/disable auto-consolidation

Output:
  { policy: { ... }, message: "..." }
```

---

#### `check_contradictions`

Check a memory for contradictions, or list all unresolved contradictions.

```
Input:
  memoryId  string  optional  — if provided, checks that memory; if omitted, lists all unresolved

Output:
  { hasContradictions, contradictions: [...], candidatesChecked, latencyMs }
```

---

#### `resolve_contradiction`

Resolve a contradiction between two memories.

```
Input:
  sourceId  string  required  — first memory ID
  targetId  string  required  — second memory ID
  strategy  string  required  — keep_newest | keep_oldest | keep_important | keep_both | manual

Output:
  { resolved, keptId, archivedId }
```

---

#### `embedding_status`

Get embedding model status — current model, stale/legacy counts.

```
Input: (none)

Output:
  { currentModel, currentDimension, totalEmbedded, currentModelCount, staleCount, legacyCount, needsReEmbed }
```

---

#### `re_embed`

Re-embed memories with the current model. Use after switching embedding models.

```
Input:
  onlyStale  boolean  optional  — only re-embed stale/legacy memories (default: true)
  batchSize  number   optional  — batch size 1–100 (default: 32)

Output:
  { total, processed, failed, failedIds, durationMs, model }
```

---

#### `index_status`

Get vector index status — how it was loaded, entry count, persistence info.

```
Input: (none)

Output:
  { loadedFrom, entryCount, dimension, indexPath, indexFileExists, incrementalCount, initDurationMs }
```

---

#### `list_tags`

Get the tag cloud, or get memories for a specific tag.

```
Input:
  tag    string  optional  — if provided, returns memories with this tag; if omitted, returns tag cloud
  limit  number  optional  — max memories when filtering by tag (default: 50)

Output:
  { count, tags: [{ tag, count }] }  — or —  { tag, count, memories: [...] }
```

---

#### `tag_memory`

Add or remove a tag on a memory.

```
Input:
  memoryId  string  required  — memory ID to tag/untag
  tag       string  required  — tag to add or remove
  action    string  optional  — "add" (default) or "remove"

Output:
  { id, tags: [...] }
```

---

#### `webhook_subscribe`

Subscribe a URL to receive HTTP callbacks on memory events.

```
Input:
  url          string    required  — HTTP(S) URL to receive POST requests
  events       string[]  required  — events: stored, forgotten, decayed, consolidated, contradiction
  secret       string    optional  — shared secret for HMAC-SHA256 signing
  description  string    optional  — human-readable description

Output:
  { id, url, events, active }
```

---

#### `webhook_list`

List all webhook subscriptions.

```
Input: (none)

Output:
  { count, webhooks: [{ id, url, events, active, failCount }] }
```

---

#### `plugin_list`

List all registered plugins with their hooks and metadata.

```
Input: (none)

Output:
  { count, plugins: [{ id, name, version, hooks, registeredAt }] }
```

---

### Recommended workflow for Claude Code sessions

```
Session start:
  1. recall_context(current_task_description)
  2. Use the returned context to inform your work

During work:
  3. store_memory() for any important decisions, findings, or user preferences
  4. add_knowledge() for facts you learn about the codebase

Session end:
  5. store_memory() with a summary of what was accomplished
```

---

## Ollama (transparent proxy)

The Ollama adapter is a transparent HTTP proxy that sits between any Ollama client and the Ollama server. It intercepts requests, injects Engram memory context, and stores responses — with zero changes to the client.

### How it works

```
Client request  →  [Engram Proxy :11435]  →  [Ollama :11434]
                        ↓                              ↓
                   /api/recall               original response
                        ↓                              ↓
                   inject context       ←   store exchange as episodic memory
```

1. Client sends chat request to `:11435`
2. Proxy extracts the user message
3. Calls Engram `/api/recall` (3s timeout — falls through gracefully if unavailable)
4. Prepends context to the system prompt
5. Forwards modified request to `:11434`
6. Streams response back to client
7. After response: stores `[User]: ... [Assistant]: ...` as episodic memory

### Setup

**1. Build the adapter**

```bash
pnpm turbo run build --filter=@engram-ai-memory/adapter-ollama
```

**2. Start the proxy**

```bash
ENGRAM_DB_PATH=/path/to/engram.db \
  node adapters/ollama/dist/proxy.js
```

**3. Point your Ollama client to port 11435**

```bash
# CLI
OLLAMA_HOST=http://localhost:11435 ollama run llama3 "Hello!"

# Open WebUI
OLLAMA_BASE_URL=http://localhost:11435

# Any OpenAI-compatible client
base_url = "http://localhost:11435/v1"
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_PROXY_PORT` | `11435` | Port the proxy listens on |
| `OLLAMA_TARGET` | `http://localhost:11434` | Real Ollama server URL |
| `ENGRAM_API` | `http://localhost:4901` | Engram REST API URL |
| `ENGRAM_MAX_TOKENS` | `1500` | Max context tokens to inject |

### Graceful degradation

If Engram is unavailable (not running, slow, or erroring), the proxy falls through silently — requests pass through to Ollama as-is. The timeout is 3 seconds to ensure Ollama response time is not significantly impacted.

---

## OpenClaw

OpenClaw integration comes in two forms:

1. **Plugin** (`adapters/openclaw-plugin/`) — drop-in memory plugin that registers 6 tools (`memory_recall`, `memory_store`, `engram_search`, `memory_forget`, `memory_list`, `memory_stats`) with auto-recall and auto-store hooks
2. **Adapter** (`adapters/openclaw/`) — `EngramClient` TypeScript class and `withMemory()` convenience wrapper for custom agent code

### Plugin (recommended)

Copy `adapters/openclaw-plugin/` to `~/.openclaw/plugins/engram/` and configure in `openclaw.json`. See the [engram.am OpenClaw docs](https://engram.am/docs/openclaw) for full setup instructions.

### Adapter (TypeScript client)

The adapter provides a `EngramClient` class and a `withMemory()` convenience wrapper for enriching agent actions with Engram context.

### Setup

**1. Build the adapter**

```bash
pnpm turbo run build --filter=@engram-ai-memory/adapter-openclaw
```

**2. Configure Engram URL in OpenClaw settings**

```json
// ~/.openclaw/openclaw.json
{
  "neuralCore": {
    "url": "http://localhost:4901"
  }
}
```

**3. Import and use in your OpenClaw agent**

```typescript
import { EngramClient, withMemory } from '@engram-ai-memory/adapter-openclaw';

// Option A — client class
const neural = new EngramClient({ url: 'http://localhost:4901' });
const context = await neural.recall(userMessage);
// prepend `context` to your system prompt

// Option B — withMemory wrapper (handles recall + store automatically)
const result = await withMemory(userMessage, async (context) => {
  const systemPrompt = context ? `${context}\n\n---\n` : '';
  return await yourAgent.run(systemPrompt + userMessage);
});
```

### `EngramClient` API

```typescript
class EngramClient {
  constructor(config: { url?: string; source?: string; timeoutMs?: number })

  // Assemble context for a query
  recall(query: string, maxTokens?: number): Promise<RecallResult>

  // Store a memory
  store(content: string, type?: 'episodic' | 'semantic' | 'procedural', options?: {
    importance?: number;
    tags?: string[];
    sessionId?: string;
  }): Promise<StoreResult>

  // Semantic search across memories
  search(query: string, options?: {
    topK?: number;
    threshold?: number;
    types?: string[];
  }): Promise<unknown[]>

  // List all memories with pagination and filtering
  list(options?: {
    type?: string;
    source?: string;
    limit?: number;    // default 50, max 200
    offset?: number;
  }): Promise<ListResult>

  // Delete (archive) a memory by ID
  forget(id: string): Promise<void>

  // Get a single memory by ID
  getById(id: string): Promise<MemoryEntry>

  // Memory statistics
  stats(): Promise<MemoryStats>

  // Health check — returns true if Engram is reachable
  ping(): Promise<boolean>
}
```

### `withMemory()` convenience wrapper

```typescript
async function withMemory(
  query: string,
  options?: { url?: string; source?: string; maxTokens?: number }
): Promise<string>
```

- Calls `/api/recall` and returns the formatted context string
- Returns empty string (not an error) if Engram is unavailable — graceful degradation
- Inject the returned string at the top of your system prompt

---

## Custom integrations (REST)

Any application can integrate with Engram directly via HTTP.

### Minimal integration pattern

```python
import requests

ENGRAM = "http://localhost:4901"

def recall_context(query: str, max_tokens: int = 2000) -> str:
    try:
        r = requests.post(f"{ENGRAM}/api/recall",
            json={"query": query, "maxTokens": max_tokens},
            timeout=5)
        return r.json().get("context", "")
    except Exception:
        return ""

def store_memory(content: str, memory_type: str = "episodic"):
    try:
        requests.post(f"{ENGRAM}/api/memory",
            json={"content": content, "type": memory_type},
            timeout=5)
    except Exception:
        pass

# Usage
context = recall_context("user's preferred programming language")
system_prompt = f"{context}\n\n---\n" if context else ""

response = your_llm.chat(system_prompt + user_message)
store_memory(f"User: {user_message}\nAssistant: {response}")
```

### Node.js / TypeScript

```typescript
const BASE = 'http://localhost:4901/api';

async function recall(query: string): Promise<string> {
  const res = await fetch(`${BASE}/recall`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, maxTokens: 2000 }),
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) return '';
  const data = await res.json();
  return data.context ?? '';
}
```

---

## CLI Integration

The `@engram-ai-memory/cli` package works directly with the database — no running server needed.

```bash
npm i -g @engram-ai-memory/cli

# Store from a script
echo "Deploy completed at $(date)" | xargs -I{} engram store "{}" --type episodic --source deploy-script

# Recall in a shell script
CONTEXT=$(engram recall "deployment history" --raw)
echo "$CONTEXT" | your-llm-cli

# Export for backup
engram export > /backups/engram-$(date +%Y%m%d).json

# Import from backup
engram import < /backups/engram-20260325.json
```

Set `ENGRAM_DB_PATH` to point at the same database your server uses.

---

## Webhooks

Subscribe external systems (Slack, CI/CD, monitoring) to memory events.

### Subscribe

```bash
curl -X POST http://localhost:4901/api/webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://hooks.slack.com/services/T.../B.../xxx",
    "events": ["stored", "contradiction"],
    "secret": "my-hmac-secret",
    "description": "Notify Slack on new memories"
  }'
```

### Events

| Event | When it fires |
|---|---|
| `stored` | New memory created |
| `forgotten` | Memory archived |
| `decayed` | Decay sweep completed |
| `consolidated` | Episodes merged into semantic |
| `contradiction` | Conflict detected on store |

### Payload format

```json
{
  "event": "stored",
  "timestamp": "2026-03-25T...",
  "data": { "id": "...", "type": "semantic", "importance": 0.8 }
}
```

When a `secret` is configured, the `X-Engram-Signature` header contains `sha256=<hmac>` for verification. Failed deliveries retry 3 times with exponential backoff. After 10 consecutive failures, the webhook is auto-disabled.

---

## Plugin Development

Plugins extend Engram with lifecycle hooks. They run in-process and have access to memory data at each lifecycle point.

### Plugin manifest

```typescript
import type { EngramPlugin } from '@engram-ai-memory/core';

const myPlugin: EngramPlugin = {
  id: 'my-org/analytics',
  name: 'Memory Analytics',
  version: '1.0.0',
  description: 'Tracks memory usage patterns',
  hooks: {
    onStore: async (ctx) => {
      console.log(`Stored: ${ctx.memory.id} (${ctx.contradictions} contradictions)`);
    },
    onRecall: async (ctx) => {
      console.log(`Recalled ${ctx.memoriesUsed} memories in ${ctx.latencyMs}ms`);
    },
    onForget: async (ctx) => {
      console.log(`Forgotten: ${ctx.memoryId}`);
    },
  },
};
```

### Available hooks

| Hook | Context | When |
|---|---|---|
| `onStore` | `{ memory, contradictions }` | After a memory is stored |
| `onRecall` | `{ query, memoriesUsed, latencyMs, context }` | After context assembly |
| `onForget` | `{ memoryId }` | After a memory is archived |
| `onDecay` | `{ scannedCount, archivedCount, ... }` | After a decay sweep |
| `onStartup` | `{ entryCount, loadedFrom, initDurationMs }` | After brain initializes |
| `onShutdown` | `{ entryCount }` | Before brain shuts down |

### Registration

```typescript
import { NeuralBrain } from '@engram-ai-memory/core';

const brain = new NeuralBrain({ dbPath: './engram.db' });
brain.registerPlugin(myPlugin);
await brain.initialize();
```

Plugin errors are isolated — a failing plugin never breaks core operations.
