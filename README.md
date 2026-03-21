# NeuralCore

> Universal AI Brain — persistent memory and cognition layer for any AI model

NeuralCore gives any AI model **human-like memory** that persists across sessions, systems, and restarts. It's an open-source, multi-platform (macOS / Ubuntu / Windows) project built to integrate anywhere.

## What it does

When any AI connected to NeuralCore receives a query, it can:
- **Remember** past conversations and events (episodic memory)
- **Know** facts and concepts and how they relate (semantic memory)
- **Apply** learned patterns and skills (procedural memory)
- **Assemble** the most relevant context for any question (working memory)

## Quick Start

```bash
# Install
git clone https://github.com/neural-core/neural-core
cd neural-core
pnpm install

# Start the server
pnpm dev

# Test the brain
curl -X POST http://localhost:3001/api/memory \
  -H "Content-Type: application/json" \
  -d '{"content": "The user prefers TypeScript over JavaScript", "type": "semantic"}'

curl -X POST http://localhost:3001/api/recall \
  -H "Content-Type: application/json" \
  -d '{"query": "What language does the user prefer?"}'
```

## Integrations

### Claude Code (MCP)
```json
// ~/.claude/settings.json
{
  "mcpServers": {
    "neural-core": {
      "command": "node",
      "args": ["/path/to/neural-core/packages/mcp/dist/server.js"]
    }
  }
}
```

### Ollama (transparent proxy)
```bash
# Point Ollama client to port 11435 instead of 11434
OLLAMA_HOST=http://localhost:11435 ollama run llama3
```

### OpenClaw
```json
// ~/.openclaw/openclaw.json
{
  "neuralCore": { "url": "http://localhost:3001" }
}
```

## Architecture

```
Claude Code ──MCP──→ [NeuralCore MCP Server]
Ollama ──────proxy──→ [REST API :3001] → [Brain Engine] → [SQLite/Postgres]
OpenClaw ────REST──→ [REST API :3001]
```

**Packages:**
- `@neural-core/core` — The Brain (memory engine, embeddings, graph, retrieval)
- `@neural-core/mcp` — MCP Server for Claude Code and MCP-compatible clients
- `@neural-core/vis` — 3D visualization helpers

## Memory Model

| Type | Description |
|------|-------------|
| **Episodic** | Events, conversations, time-stamped interactions |
| **Semantic** | Facts, knowledge, concepts + knowledge graph |
| **Procedural** | Patterns, skills, "when X do Y" rules |
| **Working** | Dynamic context assembly for the current query |

## Requirements

- Node.js 22+
- pnpm 9+

## License

MIT — see [LICENSE](LICENSE)
