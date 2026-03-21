# Contributing to Engram

Thank you for your interest in contributing! Engram is an open-source project and every contribution matters — from a typo fix to a new adapter for an AI tool you use.

---

## Ways to contribute

- **Bug reports** — open an issue with reproduction steps
- **Feature requests** — describe the use case, not just the feature
- **Pull requests** — code changes, with tests where applicable
- **New adapters** — connect Engram to a new AI tool or platform
- **Documentation** — improvements, translations, examples
- **Performance** — benchmarks, profiling, optimization

---

## Development setup

```bash
git clone https://github.com/ayvazyan10/engram
cd engram
pnpm install
pnpm turbo run build
```

Run the test suite:

```bash
pnpm turbo run test
```

Start the API server and dashboard for local development:

```bash
# Terminal 1 — API server
ENGRAM_DB_PATH=./packages/core/engram.db \
  node apps/server/dist/index.js

# Terminal 2 — Dashboard
pnpm --filter @engram/web dev
```

---

## Before you open a PR

- [ ] `pnpm turbo run build` passes with no errors
- [ ] `pnpm turbo run test` passes
- [ ] New functionality has tests (`src/**/*.test.ts`)
- [ ] Database schema changes use `drizzle-kit generate` → `drizzle-kit migrate` (never `push`)
- [ ] Docs updated if public behavior changed

---

## Branch naming

```
feature/description    new functionality
fix/description        bug fix
docs/description       documentation only
refactor/description   no behavior change
adapter/name           new integration adapter
```

---

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org):

```
feat(core): add importance decay on recall
fix(server): correct socket.io namespace initialization
feat(adapter): add LM Studio proxy adapter
docs: improve MCP setup guide
refactor(mcp): simplify tool registration pattern
```

---

## Adding a new adapter

Adapters live in `adapters/`. The simplest adapter needs two things:

1. **Recall** — call `POST /api/recall` with the user query before the AI responds
2. **Store** — call `POST /api/memory` after the AI responds to persist the exchange

See `adapters/ollama/` for a proxy pattern and `adapters/openclaw/` for a library pattern.

```typescript
// Minimal adapter pattern
const context = await fetch('http://localhost:3001/api/recall', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: userMessage, maxTokens: 2000 }),
}).then(r => r.json()).then(d => d.context).catch(() => '');

// inject `context` into system prompt, run your AI

await fetch('http://localhost:3001/api/memory', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ content: `User: ${userMessage}\nAssistant: ${response}`, type: 'episodic' }),
}).catch(() => {});
```

---

## Code style

- TypeScript strict mode (`strict: true` in tsconfig)
- No `any` types where avoidable
- Prefer explicit return types on exported functions
- No default exports in library packages (named exports only)

ESLint runs via `pnpm turbo run lint`. Fix issues before opening a PR.

---

## Issue labels

| Label | Meaning |
|---|---|
| `bug` | Something is broken |
| `enhancement` | New feature or improvement |
| `adapter` | New AI tool integration |
| `good first issue` | Suitable for first-time contributors |
| `help wanted` | Needs community input |
| `docs` | Documentation changes |
| `performance` | Speed or memory improvements |

---

## Questions?

Open a [GitHub Discussion](https://github.com/ayvazyan10/engram/discussions) — not an issue — for questions, ideas, and general conversation.
