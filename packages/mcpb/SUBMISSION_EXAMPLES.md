# Engram MCP — Submission Examples

Three worked examples for the official Claude MCP Directory submission.
Each example shows the tool name, input, and expected output.

---

## Example 1 — Session start: recall relevant context

**Scenario:** Claude Code starts a new session. Before answering the user, it recalls
everything Engram remembers about the current project.

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
```json
{
  "context": "## Knowledge\n- concept: stack → \"Node.js 22 + Fastify 5 + Drizzle ORM + SQLite (WAL mode)\"\n- concept: deployment → \"PM2 on Ubuntu 22.04 VPS, reverse-proxied by Caddy\"\n\n## Recent events\n- 2026-03-28: Decided to drop Redis in favour of SQLite WAL for the job queue — simpler ops\n- 2026-03-27: Migrated auth from JWT to session cookies after security review",
  "memoriesUsed": 4,
  "latencyMs": 19,
  "memories": [
    { "id": "a1b2c3", "type": "semantic", "score": "0.921", "source": "claude-code" },
    { "id": "d4e5f6", "type": "semantic", "score": "0.884", "source": "claude-code" },
    { "id": "g7h8i9", "type": "episodic", "score": "0.761", "source": "claude-code" },
    { "id": "j0k1l2", "type": "episodic", "score": "0.743", "source": "claude-code" }
  ]
}
```

---

## Example 2 — Store a decision, then search for it later

**Scenario:** The user makes an architectural decision. Claude stores it. Later in a
different session, Claude searches for relevant decisions before suggesting an approach.

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

**Scenario:** The user tells Claude two conflicting things on different days. Engram
detects the conflict automatically and the user resolves it.

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
  "message": "Memory stored with 1 contradiction(s) detected",
  "contradictions": {
    "count": 1,
    "items": [
      {
        "existingMemoryId": "q7r8s9t0-...",
        "confidence": 0.87,
        "signals": ["semantic_negation", "concept_conflict"],
        "suggestedStrategy": "keep_newest"
      }
    ]
  }
}
```

**Step 3 — resolve: keep the newer memory**

**Tool:** `resolve_contradiction`

**Input:**
```json
{
  "sourceId": "u1v2w3x4-...",
  "targetId": "q7r8s9t0-...",
  "strategy": "keep_newest"
}
```

**Expected output:**
```json
{
  "resolved": true,
  "keptId": "u1v2w3x4-...",
  "archivedId": "q7r8s9t0-...",
  "strategy": "keep_newest",
  "message": "Contradiction resolved via keep_newest. Kept: u1v2w3x4-..., Archived: q7r8s9t0-..."
}
```
