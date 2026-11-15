# Engram MCP — Submission Examples

Three worked examples for the official Claude MCP Directory submission.
Each example shows the tool name, input, and expected output.

Engram is the shared long-term memory for every AI tool this user works with — the same memories in Claude Code, Codex, Cursor and others. Store durable facts here so every tool can use them. When a recalled memory conflicts with the user's explicit instructions (CLAUDE.md, AGENTS.md, rules), the instructions win.
There are 15 tools visible by default and 11 admin tools hidden
unless `ENGRAM_ADMIN_TOOLS=1` (26 total when enabled).

---

## Example 1 — Recall relevant project context

**Scenario:** Prior decisions would help answer a project question. Claude Code
recalls relevant context and verifies any stale facts before relying on them.

**Tool:** `recall_context`

**Input:**
```json
{
  "query": "current project stack and recent decisions",
  "maxTokens": 1500,
  "types": ["semantic", "episodic"]
}
```

**Expected output:**
```text
## Knowledge
- [a1b2c3d4 · 2026-03-28] Node.js 22 + Fastify 5 + Drizzle ORM + SQLite (WAL mode)
- [d4e5f6a7 · 2026-03-28] PM2 on Ubuntu 22.04 VPS, reverse-proxied by Caddy

## Recent events
- [a7b8c9d0 · 2026-03-28] Decided to drop Redis in favour of SQLite WAL for the job queue — simpler ops
- [e0f1a2b3 · 2026-03-27] Migrated auth from JWT to session cookies after security review
```

---

## Example 2 — Store a decision, then search for it later

**Scenario:** The user makes an architectural decision worth retaining. Claude stores
it following the user's wishes. In a later session, Claude searches for relevant
decisions before suggesting an approach.

**Step 1 — store the decision**

**Tool:** `store_memory`

**Input:**
```json
{
  "content": "We use drizzle-kit generate + drizzle-kit migrate for all schema changes. Never use drizzle-kit push — it bypasses migration history and broke prod once.",
  "type": "procedural",
  "importance": 0.95,
  "tags": ["database", "migrations", "drizzle"]
}
```

**Expected output:**
```json
{
  "id": "m3n4o5p6-...",
  "type": "procedural",
  "importance": 0.95,
  "message": "Memory stored successfully"
}
```

**Step 2 — search for it in a future session**

**Tool:** `search_memory`

**Input:**
```json
{
  "query": "how to run database migrations",
  "topK": 5,
  "threshold": 0.4
}
```

**Expected output:**
```json
{
  "count": 1,
  "results": [
    {
      "id": "m3n4o5p6-...",
      "type": "procedural",
      "content": "We use drizzle-kit generate + drizzle-kit migrate for all schema changes. Never use drizzle-kit push — it bypasses migration history and broke prod once.",
      "importance": 0.95,
      "source": "claude-code",
      "createdAt": "2026-03-28T10:14:32.000Z"
    }
  ]
}
```

---

## Example 3 — Contradiction detection and resolution

**Scenario:** The user provides different project facts on different days. Engram
returns a possible conflict, which can be reviewed and resolved with the visible
`complete_contradiction_check` tool.

**Step 1 — store first belief**

**Tool:** `store_memory`

**Input:**
```json
{
  "content": "The production database runs on PostgreSQL 15 with pgvector.",
  "type": "semantic",
  "concept": "production-database",
  "importance": 0.8
}
```

**Expected output:**
```json
{
  "id": "q7r8s9t0-...",
  "type": "semantic",
  "importance": 0.8,
  "message": "Memory stored successfully"
}
```

**Step 2 — store contradicting belief**

**Tool:** `store_memory`

**Input:**
```json
{
  "content": "We migrated production off PostgreSQL last month — it now runs on SQLite WAL with the LiteFS replication layer.",
  "type": "semantic",
  "concept": "production-database",
  "importance": 0.85
}
```

**Expected output:**
```json
{
  "id": "u1v2w3x4-...",
  "type": "semantic",
  "importance": 0.85,
  "deduplicated": false,
  "message": "Possible conflicts: 1 existing memory/memories.",
  "contradictionCandidates": {
    "count": 1,
    "items": [
      {
        "existingMemoryId": "q7r8s9t0-...",
        "content": "The production database runs on PostgreSQL 15 with pgvector.",
        "createdAt": "2026-03-01T10:00:00.000Z",
        "confidence": 0.87,
        "signals": ["semantic_negation", "concept_conflict"],
        "suggestedStrategy": "keep_newest"
      }
    ]
  }
}
```

**Step 3 — confirm the conflict and keep the newer memory**

**Tool:** `complete_contradiction_check`

**Input:**
```json
{
  "sourceId": "u1v2w3x4-...",
  "targetId": "q7r8s9t0-...",
  "verdict": "contradiction",
  "strategy": "keep_newest"
}
```

**Expected output:**
```json
{
  "sourceId": "u1v2w3x4-...",
  "targetId": "q7r8s9t0-...",
  "verdict": "contradiction",
  "resolution": {
    "resolved": true,
    "keptId": "u1v2w3x4-...",
    "archivedId": "q7r8s9t0-..."
  }
}
```
