# Development Guide

---

## Prerequisites

| Tool | Version | Install |
|---|---|---|
| Node.js | 22 LTS | [nodejs.org](https://nodejs.org) |
| pnpm | 9.15.4+ | `npm install -g pnpm` |
| Git | any recent | system package manager |

---

## Initial setup

```bash
git clone https://github.com/ayvazyan10/engram
cd engram
pnpm install
```

This installs all workspace dependencies across all packages in one step.

---

## Monorepo overview

Engram uses **pnpm workspaces** with **Turborepo** for build orchestration.

```
pnpm-workspace.yaml   declares workspaces: apps/*, packages/*, adapters/*, tooling/*
turbo.json            pipeline: build, test, lint, e2e — with dependency ordering
```

### Build pipeline

Turborepo respects `dependsOn: ["^build"]` — packages are always built in dependency order:

```
tooling/tsconfig  →  packages/core  →  packages/mcp
                                    →  apps/server
                  →  packages/vis   →  apps/web
adapters/* (depend on core)
```

### Useful commands

```bash
# Build everything
pnpm turbo run build

# Build a single package (+ its dependencies)
pnpm turbo run build --filter=@engram-ai-memory/server

# Force rebuild (ignore cache)
pnpm turbo run build --force

# Run all tests
pnpm turbo run test

# Lint all packages
pnpm turbo run lint

# Type-check without emitting
pnpm turbo run typecheck
```

---

## Running in development

### Start the API server

The server needs to be running for the dashboard and all adapters to work.

```bash
# Option A — run compiled dist (after build)
ENGRAM_DB_PATH=./packages/core/engram.db \
  node apps/server/dist/index.js

# Option B — run with tsx (hot reload, no build step)
cd apps/server
ENGRAM_DB_PATH=../core/engram.db \
  npx tsx src/index.ts
```

Server starts at `http://localhost:4901`.

### Start the dashboard

In production, the 3D dashboard is served from the API server at `http://localhost:4901` (after building with `pnpm turbo run build`).

For development with hot-reload:

```bash
pnpm --filter @engram-ai-memory/web dev
# → http://localhost:4902 (dev only — proxies to API on 4901)
```

The Vite dev server proxies `/api` → `localhost:4901` and `/socket.io` → `localhost:4901`.

### Seed demo data

```bash
cd packages/core
npx tsx scripts/demo.ts
```

This loads 67 memories with 34 knowledge graph connections.

### Reset the database

```bash
rm packages/core/engram.db
pnpm db:migrate
# optionally re-seed
cd packages/core && npx tsx scripts/demo.ts
```

---

## Database workflow

**Never use `drizzle-kit push`** — it drops and recreates tables, destroying all data.

```bash
# 1. Edit the schema
vim packages/core/src/db/schema.ts

# 2. Generate migration SQL
pnpm db:generate
# → creates packages/core/src/db/migrations/XXXX_*.sql

# 3. Review the generated SQL before applying
cat packages/core/src/db/migrations/*.sql

# 4. Apply the migration
pnpm db:migrate
```

Root-level scripts:

```json
"db:generate": "pnpm --filter @engram-ai-memory/core exec drizzle-kit generate",
"db:migrate":  "pnpm --filter @engram-ai-memory/core exec drizzle-kit migrate"
```

---

## TypeScript configuration

Shared configs live in `tooling/tsconfig/`:

| Config | Used by | Key settings |
|---|---|---|
| `base.json` | all packages | `strict: true`, `exactOptionalPropertyTypes: false` |
| `node.json` | server, adapters, mcp | `module: NodeNext`, `types: ["node"]` |
| `react.json` | apps/web | `jsx: react-jsx`, `moduleResolution: Bundler` |

Each package extends the relevant shared config. Add package-specific overrides in the package's own `tsconfig.json`.

---

## Package structure

### Adding a new package

```bash
mkdir packages/my-package
cd packages/my-package
cat > package.json << 'EOF'
{
  "name": "@engram-ai-memory/my-package",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "scripts": {
    "build": "tsc",
    "test": "vitest run"
  }
}
EOF

cat > tsconfig.json << 'EOF'
{
  "extends": "@engram-ai-memory/tsconfig/node.json",
  "compilerOptions": { "outDir": "./dist" },
  "include": ["src"]
}
EOF
```

### Adding a dependency

```bash
# Add to a specific package
pnpm --filter @engram-ai-memory/server add fastify

# Add a dev dependency to the workspace root
pnpm add -Dw typescript
```

---

## Testing

Tests use **Vitest** (runs natively with ESM, no transpilation needed).

```bash
# Run all tests once
pnpm turbo run test

# Watch mode for a package
pnpm --filter @engram-ai-memory/core exec vitest

# With coverage, and enforcing that package's thresholds
pnpm turbo run test:coverage
```

Every package with a `test` script has a matching `test:coverage` script, and CI runs `test:coverage` in place of `test` — it runs the same suites and additionally fails a package that drops below its own thresholds.

Test files: `src/**/*.test.ts`

### Key test areas

| Test | File | What it checks |
|---|---|---|
| Embedder roundtrip | `core/src/embedding/Embedder.test.ts` | embed → pack → unpack → cosine sim > 0.99 |
| Vector search | `core/src/retrieval/VectorSearch.test.ts` | correct top-1 result |
| Brain store + recall | `core/src/NeuralBrain.test.ts` | store → recall finds the memory |
| Graph traversal | `core/src/graph/KnowledgeGraph.test.ts` | BFS depth 2 returns connected nodes |

---

## Contributing

### Branch naming

```
feature/description    new functionality
fix/description        bug fix
docs/description       documentation only
refactor/description   no behavior change
```

### Commit messages

Follow conventional commits:

```
feat(core): add importance decay on recall
fix(server): correct socket.io namespace initialization
docs: add integration guide for Custom Agent
refactor(mcp): simplify tool registration pattern
```

### Pull request checklist

- [ ] `pnpm turbo run build` passes with no errors
- [ ] `pnpm turbo run lint` passes — it is a hard CI gate, not advisory
- [ ] `pnpm turbo run test:coverage` passes, including each package's coverage thresholds
- [ ] New functionality has tests
- [ ] Database changes use `drizzle-kit generate` + `migrate` (never `push`)
- [ ] Documentation updated if behavior changed

---

## CI/CD

GitHub Actions workflows in `.github/workflows/`:

| Workflow | Trigger | Steps |
|---|---|---|
| `ci.yml` | push / PR to main | install → typecheck → lint → build → migrations → test with coverage → validate the Desktop Extension manifest |
| `release.yml` | push tag `v*` | build → publish packages to npm |

### Local CI simulation

```bash
pnpm install --frozen-lockfile
pnpm turbo run typecheck
pnpm turbo run lint
pnpm turbo run build
pnpm turbo run test:coverage
```

ESLint runs from the shared config in `tooling/`. Two rules are relaxed on purpose and worth knowing about: `no-console` is off for the CLI, whose stdout *is* its user interface, and `react/no-unknown-property` is off for the three canvas files, because the plugin only knows HTML attributes and every report there was a react-three-fiber prop.

---

## Docker

`docker-compose.yml` provides a containerised environment:

```bash
# Start all services
docker-compose up -d

# Services:
#   api:4901        — Engram REST API (SQLite inside the container)
#   web:4902        — Dashboard (standalone container, optional)
#   postgres:5432   — for cloud-sync testing only, never a primary backend

# Logs
docker-compose logs -f api
```

**All three publish on `127.0.0.1` only.** Binding them to every interface published an unauthenticated API — and a database whose password is in the compose file — on whatever network the host happens to be on. Exposing the API deliberately means setting `ENGRAM_API_KEY`, adding the public hostname to `ENGRAM_ALLOWED_HOSTS`, and only then changing the published address.

The Postgres password comes from the environment: `POSTGRES_PASSWORD` in your shell or a `.env` file, defaulting to `dev_password`. Set a real one before moving that port off loopback.

`ENGRAM_API_KEY` is deliberately **not** templated as `${ENGRAM_API_KEY}` in the compose file — an unset variable would expand to an empty string, which the server now refuses to start with. Uncomment the line and set a real value instead.

The `api` service is reached by the name `api` from the web container, which is why `ENGRAM_ALLOWED_HOSTS` lists it alongside `localhost` and `127.0.0.1`.

Environment variables for Docker are configured in `docker-compose.yml`. For multi-device sync, set `ENGRAM_SYNC_URL` to a PostgreSQL connection string — see [Cloud Sync](CLOUD-SYNC.md).
